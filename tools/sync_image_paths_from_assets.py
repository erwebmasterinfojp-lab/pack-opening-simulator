import argparse
import json
from pathlib import Path

# py tools/sync_image_paths_from_assets.py --set M5

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CARD_DIR = ROOT_DIR / "data" / "cards"
DEFAULT_ASSET_IMAGE_DIR = ROOT_DIR / "assets" / "cards"

IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"]


def sanitize_filename(value: str) -> str:
    value = str(value)

    for char in ['\\', '/', ':', '*', '?', '"', '<', '>', '|']:
        value = value.replace(char, "_")

    return value.strip().replace(" ", "_")


def build_expected_stem(card: dict) -> str:
    card_no = sanitize_filename(card.get("cardNo", "unknown"))
    rarity = sanitize_filename(card.get("rarity", "unknown"))
    name = sanitize_filename(card.get("name", "unknown"))
    official_card_id = sanitize_filename(card.get("officialCardId", "manual"))

    return f"{card_no}_{rarity}_{name}_{official_card_id}"


def build_loose_stem(card: dict) -> str:
    card_no = sanitize_filename(card.get("cardNo", "unknown"))
    rarity = sanitize_filename(card.get("rarity", "unknown"))
    name = sanitize_filename(card.get("name", "unknown"))

    return f"{card_no}_{rarity}_{name}"


def find_image_for_card(card: dict, image_dir: Path) -> Path | None:
    expected_stem = build_expected_stem(card)

    for ext in IMAGE_EXTENSIONS:
        candidate = image_dir / f"{expected_stem}{ext}"

        if candidate.exists():
            return candidate

    loose_stem = build_loose_stem(card)

    for path in image_dir.iterdir():
        if not path.is_file():
            continue

        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        if path.stem.startswith(loose_stem):
            return path

    return None


def get_relative_path_for_web(path: Path) -> str:
    return "./" + path.relative_to(ROOT_DIR).as_posix()


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument("--set", dest="set_code", required=True)
    parser.add_argument("--input", dest="input_file", default=None)
    parser.add_argument("--image-dir", default=None)
    parser.add_argument("--overwrite-path", action="store_true")

    args = parser.parse_args()

    set_code = args.set_code

    card_file = (
        Path(args.input_file)
        if args.input_file
        else DEFAULT_CARD_DIR / f"{set_code}.json"
    )

    image_dir = (
        Path(args.image_dir)
        if args.image_dir
        else DEFAULT_ASSET_IMAGE_DIR / set_code
    )

    if not card_file.exists():
        raise FileNotFoundError(f"カードマスターが見つかりません: {card_file}")

    if not image_dir.exists():
        raise FileNotFoundError(f"画像フォルダが見つかりません: {image_dir}")

    cards = json.loads(card_file.read_text(encoding="utf-8"))

    updated_count = 0
    skipped_count = 0
    missing_count = 0

    for card in cards:
        if str(card.get("setCode")) != set_code:
            continue

        label = f"{card.get('cardNo')} {card.get('name')} {card.get('rarity')}"

        if card.get("imageLocalPath") and not args.overwrite_path:
            skipped_count += 1
            continue

        image_path = find_image_for_card(card, image_dir)

        if not image_path:
            print(f"missing: {label}")
            missing_count += 1
            continue

        card["imageLocalPath"] = get_relative_path_for_web(image_path)

        if not card.get("imageSource"):
            card["imageSource"] = "local_assets"

        print(f"updated: {label} -> {card['imageLocalPath']}")
        updated_count += 1

    card_file.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("done")
    print(f"updated: {updated_count}")
    print(f"skipped existing: {skipped_count}")
    print(f"missing: {missing_count}")
    print(f"json: {card_file}")


if __name__ == "__main__":
    main()