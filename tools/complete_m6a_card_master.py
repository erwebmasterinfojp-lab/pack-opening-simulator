import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import requests


ROOT_DIR = Path(__file__).resolve().parents[1]
CARD_FILE = ROOT_DIR / "data" / "cards" / "M6a.json"
IMAGE_DIR = ROOT_DIR / "assets" / "cards" / "M6a"
PACK_IMAGE_PATH = ROOT_DIR / "assets" / "packs" / "M6a-30th CELEBRATION.webp"

COLLECTION_URL = (
    "https://torecacamp-pokemon.com/collections/m6a/products.json?limit=250"
)
OFFICIAL_PRODUCT_URL = "https://www.30th.pokemon-card.com/product/m6a"
OFFICIAL_PACK_IMAGE_URL = (
    "https://www.30th.pokemon-card.com/images/m6a/m6a_pillow_4f272152.webp"
)
LEGEND_TOP_SOURCE_URL = (
    "https://pao-onlineshop.com/view/item/000000149078?category_page_id=m6a"
)
LEGEND_TOP_IMAGE_URL = (
    "https://makeshop-multi-images.akamaized.net/PAOonline/itemimages/"
    "000000149078_504PF04.jpg"
)
RGB_SOURCE_URL = (
    "https://media.on-gacha.com/pokecard-30th-celebration-release/"
)
RGB_CARD_SPECS = [
    {
        "card_no": "R/RGB",
        "color": "red",
        "image_url": (
            "https://media.on-gacha.com/wp-content/uploads/2026/09/"
            "mew-r-rgb.webp"
        ),
    },
    {
        "card_no": "G/RGB",
        "color": "green",
        "image_url": (
            "https://media.on-gacha.com/wp-content/uploads/2026/09/"
            "mew-g-rgb.webp"
        ),
    },
    {
        "card_no": "B/RGB",
        "color": "blue",
        "image_url": (
            "https://media.on-gacha.com/wp-content/uploads/2026/09/"
            "mew-b-rgb.webp"
        ),
    },
]

ENERGY_NAMES = [
    "基本草エネルギー",
    "基本炎エネルギー",
    "基本水エネルギー",
    "基本雷エネルギー",
    "基本超エネルギー",
    "基本闘エネルギー",
    "基本悪エネルギー",
    "基本鋼エネルギー",
]


def normalize_name(value: str) -> str:
    return re.sub(r"[\s　・＆&]", "", value or "").lower()


def sanitize_filename(value: str) -> str:
    value = re.sub(r'[\\/:*?"<>|]', "_", value.strip())
    return re.sub(r"\s+", "_", value)


def download(
    url: str,
    output_path: Path,
    overwrite: bool,
    sleep_seconds: float,
) -> None:
    if output_path.exists() and not overwrite:
        return

    response = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    response.raise_for_status()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(response.content)
    time.sleep(max(0, sleep_seconds))


def image_extension(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"


def web_path(path: Path) -> str:
    return "./" + path.relative_to(ROOT_DIR).as_posix()


def get_collection_products() -> list[dict]:
    response = requests.get(
        COLLECTION_URL,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["products"]


def get_image_url(product: dict) -> str:
    images = product.get("images") or []
    if not images:
        raise ValueError(f"画像がありません: {product.get('title')}")
    return images[0]["src"]


def classify_existing_cards(cards: list[dict]) -> None:
    for card in cards:
        card_no = int(card["cardNo"])

        if 17 <= card_no <= 46:
            card["rarity"] = "PIKACHU"
        elif 136 <= card_no <= 165:
            card["rarity"] = "30th"
        elif not card.get("rarity"):
            card["rarity"] = "H"

        old_image_path_value = card.get("imageLocalPath")
        if old_image_path_value:
            old_image_path = ROOT_DIR / old_image_path_value.removeprefix("./")
            extension = old_image_path.suffix
            new_image_path = IMAGE_DIR / (
                f"{card['cardNo']}_{card['rarity']}_"
                f"{sanitize_filename(card['name'])}_"
                f"{sanitize_filename(str(card['officialCardId']))}{extension}"
            )

            if old_image_path != new_image_path:
                if old_image_path.exists() and not new_image_path.exists():
                    old_image_path.replace(new_image_path)

                if new_image_path.exists():
                    card["imageLocalPath"] = web_path(new_image_path)

        if not card.get("packName"):
            card["packName"] = "拡張パック「30th CELEBRATION」"


def build_numbered_supplement(
    product: dict,
    base_cards_by_name: dict[str, dict],
    overwrite: bool,
    sleep_seconds: float,
) -> dict | None:
    title = product.get("title", "")
    match = re.search(r"M6a\s+(\d{3})/103$", title)
    if not match:
        return None

    card_no = int(match.group(1))
    if card_no not in {*range(104, 136), 152}:
        return None

    name_and_rarity = title[: match.start()].strip()
    rarity_match = re.search(r"\s+(AR|SAR|FUR)$", name_and_rarity)
    rarity = rarity_match.group(1) if rarity_match else "30th"
    name = (
        name_and_rarity[: rarity_match.start()].strip()
        if rarity_match
        else name_and_rarity
    )
    name = re.sub(r"^【[上下]】", "", name).strip()

    base_card = base_cards_by_name.get(normalize_name(name), {})
    if card_no == 152 and not base_card:
        base_card = base_cards_by_name.get(
            normalize_name("ダークライ&クレセリアLEGEND"),
            {},
        )

    image_url = get_image_url(product)
    extension = image_extension(image_url)
    image_path = IMAGE_DIR / (
        f"{card_no:03d}_{rarity}_{sanitize_filename(name)}_manual{extension}"
    )
    download(image_url, image_path, overwrite, sleep_seconds)

    source_url = (
        f"https://torecacamp-pokemon.com/products/{product['handle']}"
    )

    return {
        "officialCardId": f"manual-M6a-{card_no:03d}",
        "setCode": "M6a",
        "cardNo": f"{card_no:03d}",
        "cardNoTotal": "103",
        "name": name,
        "rarity": rarity,
        "category": base_card.get("category", "pokemon"),
        "pokemonType": base_card.get("pokemonType"),
        "trainerType": base_card.get("trainerType"),
        "evolutionStage": base_card.get("evolutionStage"),
        "hp": base_card.get("hp"),
        "packName": "拡張パック「30th CELEBRATION」",
        "sourceUrl": OFFICIAL_PRODUCT_URL,
        "imageSourceUrl": source_url,
        "imageUrl": image_url,
        "imageLocalPath": web_path(image_path),
    }


def update_legend_top_card(
    cards: list[dict],
    sleep_seconds: float,
) -> None:
    legend_top_card = next(
        (card for card in cards if card.get("cardNo") == "151"),
        None,
    )
    if not legend_top_card:
        raise ValueError("151/103のLEGEND上側カードが見つかりません。")

    image_path = IMAGE_DIR / (
        "151_30th_ダークライ&クレセリアLEGEND_50728.jpg"
    )

    # 公式検索画像は上下2枚を連結した画像のため、上側単体画像で上書きする。
    download(
        LEGEND_TOP_IMAGE_URL,
        image_path,
        True,
        sleep_seconds,
    )
    legend_top_card["imageSourceUrl"] = LEGEND_TOP_SOURCE_URL
    legend_top_card["imageUrl"] = LEGEND_TOP_IMAGE_URL
    legend_top_card["imageLocalPath"] = web_path(image_path)


def build_energy_card(
    product: dict,
    energy_index: int,
    overwrite: bool,
    sleep_seconds: float,
) -> dict:
    name = ENERGY_NAMES[energy_index]
    image_url = get_image_url(product)
    extension = image_extension(image_url)
    card_no = f"E{energy_index + 1:02d}"
    image_path = IMAGE_DIR / (
        f"{card_no}_ENERGY_{sanitize_filename(name)}_manual{extension}"
    )
    download(image_url, image_path, overwrite, sleep_seconds)

    return {
        "officialCardId": f"manual-M6a-energy-{energy_index + 1:02d}",
        "setCode": "M6a",
        "cardNo": card_no,
        "cardNoTotal": "103",
        "name": name,
        "rarity": "ENERGY",
        "category": "energy",
        "pokemonType": None,
        "trainerType": None,
        "evolutionStage": None,
        "hp": None,
        "packName": "拡張パック「30th CELEBRATION」",
        "sourceUrl": OFFICIAL_PRODUCT_URL,
        "imageSourceUrl": (
            f"https://torecacamp-pokemon.com/products/{product['handle']}"
        ),
        "imageUrl": image_url,
        "imageLocalPath": web_path(image_path),
    }


def build_rgb_card(
    spec: dict,
    overwrite: bool,
    sleep_seconds: float,
) -> dict:
    card_no = spec["card_no"]
    color = spec["color"]
    image_url = spec["image_url"]
    extension = image_extension(image_url)
    filename_card_no = sanitize_filename(card_no).replace("_", "-")
    image_path = IMAGE_DIR / (
        f"{filename_card_no}_RGB_ミュウ_manual{extension}"
    )
    download(image_url, image_path, overwrite, sleep_seconds)

    return {
        "officialCardId": f"manual-M6a-rgb-{color}",
        "setCode": "M6a",
        "cardNo": card_no,
        "cardNoTotal": "RGB",
        "name": "ミュウ",
        "rarity": "RGB",
        "rgbColor": color,
        "category": "pokemon",
        "pokemonType": "超",
        "trainerType": None,
        "evolutionStage": "たね",
        "hp": 60,
        "packName": "拡張パック「30th CELEBRATION」",
        "sourceUrl": RGB_SOURCE_URL,
        "imageSourceUrl": RGB_SOURCE_URL,
        "imageUrl": image_url,
        "imageLocalPath": web_path(image_path),
    }


def card_sort_key(card: dict) -> tuple:
    card_no = str(card["cardNo"])

    if card_no.isdigit():
        return (0, int(card_no))
    if card_no.endswith("/RGB"):
        color_order = {"R/RGB": 0, "G/RGB": 1, "B/RGB": 2}
        return (1, color_order.get(card_no, 99))
    if card_no.startswith("E") and card_no[1:].isdigit():
        return (2, int(card_no[1:]))

    return (3, card_no)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args()

    cards = json.loads(CARD_FILE.read_text(encoding="utf-8"))
    cards = [
        card
        for card in cards
        if not str(card.get("officialCardId", "")).startswith("manual-M6a-")
    ]
    classify_existing_cards(cards)
    update_legend_top_card(cards, args.sleep)

    base_cards_by_name = {
        normalize_name(card.get("name", "")): card
        for card in cards
    }
    products = get_collection_products()
    supplements = []
    energy_products = {}

    for product in products:
        title = product.get("title", "")
        supplement = build_numbered_supplement(
            product,
            base_cards_by_name,
            args.overwrite,
            args.sleep,
        )
        if supplement:
            supplements.append(supplement)

        for index, energy_name in enumerate(ENERGY_NAMES):
            if title == f"{energy_name} M6a":
                energy_products[index] = product

    numbered_cards = {card["cardNo"] for card in supplements}
    expected_numbered_cards = {
        f"{number:03d}" for number in [*range(104, 136), 152]
    }
    missing_numbered_cards = expected_numbered_cards - numbered_cards
    if missing_numbered_cards:
        raise ValueError(
            "不足している補完カード: "
            + ", ".join(sorted(missing_numbered_cards))
        )

    if set(energy_products) != set(range(len(ENERGY_NAMES))):
        raise ValueError("基本エネルギー8種を取得できませんでした。")

    energy_cards = [
        build_energy_card(
            energy_products[index],
            index,
            args.overwrite,
            args.sleep,
        )
        for index in range(len(ENERGY_NAMES))
    ]
    rgb_cards = [
        build_rgb_card(spec, args.overwrite, args.sleep)
        for spec in RGB_CARD_SPECS
    ]

    cards.extend(supplements)
    cards.extend(rgb_cards)
    cards.extend(energy_cards)
    cards.sort(key=card_sort_key)

    if len(cards) != 176:
        raise ValueError(f"カード総数が176件ではありません: {len(cards)}")

    CARD_FILE.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    download(
        OFFICIAL_PACK_IMAGE_URL,
        PACK_IMAGE_PATH,
        args.overwrite,
        args.sleep,
    )

    print(f"updated: {CARD_FILE}")
    print(f"cards: {len(cards)}")
    print(f"supplements: {len(supplements)}")
    print("legend top image: updated")
    print(f"rgb cards: {len(rgb_cards)}")
    print(f"energies: {len(energy_cards)}")
    print(f"pack image: {PACK_IMAGE_PATH}")


if __name__ == "__main__":
    main()
