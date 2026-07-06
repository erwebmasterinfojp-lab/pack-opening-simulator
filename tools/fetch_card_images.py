import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://www.pokemon-card.com"

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CARDS_DIR = ROOT_DIR / "data" / "cards"
DEFAULT_RAW_DIR = ROOT_DIR / "data" / "raw"
DEFAULT_IMAGE_ROOT_DIR = ROOT_DIR / "assets" / "cards"


def sanitize_filename(value: str) -> str:
    """
    Windows / macOS / Linuxで使いにくい文字を除去する。
    日本語ファイル名はそのまま残す。
    """
    value = value.strip()
    value = re.sub(r'[\\/:*?"<>|]', "_", value)
    value = re.sub(r"\s+", "_", value)
    return value


def load_cards(card_file: Path) -> list[dict]:
    return json.loads(card_file.read_text(encoding="utf-8"))


def save_cards(card_file: Path, cards: list[dict]) -> None:
    card_file.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_raw_html_path(raw_dir: Path, official_card_id: str) -> Path:
    return raw_dir / f"{official_card_id}.html"


def fetch_html_from_source(source_url: str) -> str | None:
    response = requests.get(
        source_url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=20,
    )

    if response.status_code != 200:
        print(f"  HTML取得失敗: {response.status_code}")
        return None

    response.encoding = response.apparent_encoding
    return response.text


def get_html(card: dict, raw_dir: Path, use_raw_cache: bool) -> str | None:
    official_card_id = str(card.get("officialCardId", ""))

    if use_raw_cache and official_card_id:
        raw_html_path = get_raw_html_path(raw_dir, official_card_id)

        if raw_html_path.exists():
            return raw_html_path.read_text(encoding="utf-8")

    source_url = card.get("sourceUrl")

    if not source_url:
        return None

    html = fetch_html_from_source(source_url)

    if html and official_card_id:
        raw_dir.mkdir(parents=True, exist_ok=True)
        get_raw_html_path(raw_dir, official_card_id).write_text(html, encoding="utf-8")

    return html


def extract_card_image_url(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")

    # 公式カード詳細のメイン画像は多くの場合これ
    main_img = soup.select_one(".LeftBox img.fit")

    if main_img and main_img.get("src"):
        return urljoin(BASE_URL, main_img["src"])

    # フォールバック：card_images/large を含む画像
    for img in soup.find_all("img"):
        src = img.get("src", "")

        if "card_images/large" in src:
            return urljoin(BASE_URL, src)

    return None


def get_image_extension(image_url: str, content_type: str | None) -> str:
    path = urlparse(image_url).path
    suffix = Path(path).suffix.lower()

    if suffix in [".jpg", ".jpeg", ".png", ".webp"]:
        return ".jpg" if suffix == ".jpeg" else suffix

    if content_type:
        if "png" in content_type:
            return ".png"
        if "webp" in content_type:
            return ".webp"
        if "jpeg" in content_type or "jpg" in content_type:
            return ".jpg"

    return ".jpg"


def build_image_file_path(card: dict, image_dir: Path, extension: str) -> Path:
    card_no = sanitize_filename(str(card.get("cardNo", "unknown")))
    rarity = sanitize_filename(str(card.get("rarity", "unknown")))
    name = sanitize_filename(str(card.get("name", "unknown")))
    official_card_id = sanitize_filename(str(card.get("officialCardId", "unknown")))

    filename = f"{card_no}_{rarity}_{name}_{official_card_id}{extension}"

    return image_dir / filename


def download_image(image_url: str, output_path_without_ext: Path, overwrite: bool) -> Path | None:
    response = requests.get(
        image_url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )

    if response.status_code != 200:
        print(f"  画像取得失敗: {response.status_code}")
        return None

    content_type = response.headers.get("Content-Type", "")
    extension = get_image_extension(image_url, content_type)

    output_path = output_path_without_ext.with_suffix(extension)

    if output_path.exists() and not overwrite:
        return output_path

    output_path.write_bytes(response.content)

    return output_path


def get_relative_path_for_web(path: Path) -> str:
    """
    index.html から見た相対パスにする。
    WindowsでもWeb用に / 区切りにする。
    """
    relative_path = path.relative_to(ROOT_DIR)
    return "./" + relative_path.as_posix()


def should_skip_card(card: dict) -> bool:
    """
    手動追加カードなど、公式sourceUrlがないものはスキップ。
    """
    if not card.get("sourceUrl"):
        return True

    official_card_id = str(card.get("officialCardId", ""))

    if official_card_id.startswith("manual-"):
        return True

    return False


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument("--set", dest="set_code", required=True)
    parser.add_argument("--input", dest="input_file", default=None)
    parser.add_argument("--raw-dir", default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--sleep", type=float, default=0.3)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--no-update-json", action="store_true")
    parser.add_argument("--no-raw-cache", action="store_true")

    args = parser.parse_args()

    set_code = args.set_code

    card_file = (
        Path(args.input_file)
        if args.input_file
        else DEFAULT_CARDS_DIR / f"{set_code}.json"
    )

    raw_dir = Path(args.raw_dir) if args.raw_dir else DEFAULT_RAW_DIR
    image_dir = (
        Path(args.output_dir)
        if args.output_dir
        else DEFAULT_IMAGE_ROOT_DIR / set_code
    )

    if not card_file.exists():
        raise FileNotFoundError(f"カードマスターが見つかりません: {card_file}")

    image_dir.mkdir(parents=True, exist_ok=True)

    cards = load_cards(card_file)

    downloaded_count = 0
    skipped_count = 0
    failed_count = 0

    print(f"card file: {card_file}")
    print(f"image dir: {image_dir}")

    for card in cards:
        card_label = f"{card.get('cardNo')} {card.get('name')} {card.get('rarity')}"

        if should_skip_card(card):
            print(f"skip: {card_label} sourceUrlなし")
            skipped_count += 1
            continue

        print(f"target: {card_label}")

        html = get_html(
            card=card,
            raw_dir=raw_dir,
            use_raw_cache=not args.no_raw_cache,
        )

        if not html:
            print("  HTMLなし")
            failed_count += 1
            continue

        image_url = extract_card_image_url(html)

        if not image_url:
            print("  画像URL抽出失敗")
            failed_count += 1
            continue

        # まず拡張子なしの仮パスを作り、レスポンスのContent-Type等から拡張子を決める
        temp_output_path = build_image_file_path(card, image_dir, ".tmp")

        saved_path = download_image(
            image_url=image_url,
            output_path_without_ext=temp_output_path,
            overwrite=args.overwrite,
        )

        if not saved_path:
            failed_count += 1
            continue

        card["imageUrl"] = image_url
        card["imageLocalPath"] = get_relative_path_for_web(saved_path)

        print(f"  saved: {card['imageLocalPath']}")
        downloaded_count += 1

        time.sleep(args.sleep)

    if not args.no_update_json:
        save_cards(card_file, cards)
        print(f"updated json: {card_file}")

    print("done")
    print(f"downloaded: {downloaded_count}")
    print(f"skipped: {skipped_count}")
    print(f"failed: {failed_count}")


if __name__ == "__main__":
    main()