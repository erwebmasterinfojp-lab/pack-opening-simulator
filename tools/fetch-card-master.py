import argparse
import json
import re
import time
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup


DEFAULT_REGU = "XY"

BASE_URL = "https://www.pokemon-card.com/card-search/details.php/card/{card_id}/regu/{regu}"

ROOT_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT_DIR / "data" / "raw"
OUTPUT_DIR = ROOT_DIR / "data" / "cards"


TYPE_CLASS_MAP = {
    "icon-grass": "草",
    "icon-fire": "炎",
    "icon-water": "水",
    "icon-lightning": "雷",
    "icon-psychic": "超",
    "icon-fighting": "闘",
    "icon-darkness": "悪",
    "icon-metal": "鋼",
    "icon-dragon": "ドラゴン",
    "icon-colorless": "無色",
}


TRAINER_TYPES = {
    "グッズ": "グッズ",
    "ポケモンのどうぐ": "どうぐ",
    "サポート": "サポート",
    "スタジアム": "スタジアム",
}

RARITY_VALUES = [
    "C",
    "U",
    "R",
    "RR",
    "AR",
    "SR",
    "SAR",
    "UR",
    "HR",
    "SSR",
]

def normalize_text(text):
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def get_raw_file_path(card_id):
    return RAW_DIR / f"{card_id}.html"


def fetch_html(card_id, regu, use_cache=True):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_file = get_raw_file_path(card_id)

    if use_cache and raw_file.exists():
        return raw_file.read_text(encoding="utf-8")

    url = BASE_URL.format(card_id=card_id, regu=regu)
    print(f"fetch: {url}")

    response = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=20,
    )

    if response.status_code != 200:
        print(f"skip: {card_id} status={response.status_code}")
        return None

    response.encoding = response.apparent_encoding
    html = response.text

    raw_file.write_text(html, encoding="utf-8")

    return html


def extract_name(soup):
    h1 = soup.find("h1")
    if not h1:
        return None
    return normalize_text(h1.get_text())


def extract_set_code(soup, html):
    for img in soup.find_all("img"):
        alt = normalize_text(img.get("alt", ""))

        if re.fullmatch(r"[A-Z]\d+[a-zA-Z]?", alt):
            return alt

    match = re.search(r'alt=["\']([A-Z]\d+[a-zA-Z]?)["\']', html)
    if match:
        return match.group(1)

    return None


def extract_card_no(text):
    match = re.search(r"(\d{3})\s*/\s*(\d{3})", text)

    if not match:
        return None, None

    return match.group(1), match.group(2)


def extract_pack_name(text):
    match = re.search(r"拡張パック「([^」]+)」", text)
    if not match:
        return None
    return f"拡張パック「{match.group(1)}」"


def extract_hp(text):
    match = re.search(r"HP\s*(\d+)", text)
    if not match:
        return None
    return int(match.group(1))


def extract_evolution_stage(text):
    if "たね" in text:
        return "たね"
    if "1進化" in text:
        return "1進化"
    if "2進化" in text:
        return "2進化"
    return None


def extract_pokemon_type(html):
    for class_name, type_name in TYPE_CLASS_MAP.items():
        if class_name in html:
            return type_name
    return None


def extract_trainer_type(text):
    for keyword, trainer_type in TRAINER_TYPES.items():
        if keyword in text:
            return trainer_type
    return None

def extract_rarity(soup, html, text):
    """
    公式HTMLからレアリティを取得する。

    注意:
    HTML全体に対して単純に "sr" in html のような判定をすると、
    imgタグの src などに反応して全カードSR扱いになるためNG。
    そのため、以下のように「値としてレアリティが入っていそうな箇所」だけを見る。
    """

    rarity_pattern = r"(SAR|SR|UR|HR|AR|RR|R|U|C)"

    # 1. imgタグの alt / title が完全に C / U / R / RR 等の場合だけ採用
    for img in soup.find_all("img"):
        candidates = [
            normalize_text(img.get("alt", "")),
            normalize_text(img.get("title", "")),
        ]

        for candidate in candidates:
            if candidate in RARITY_VALUES:
                return candidate

    # 2. class名に rarity / rare が含まれるタグの周辺だけを見る
    for tag in soup.find_all(True):
        class_values = tag.get("class", [])
        class_text = " ".join(class_values).lower()

        if "rarity" not in class_text and "rare" not in class_text:
            continue

        tag_text = normalize_text(tag.get_text(" "))

        if tag_text in RARITY_VALUES:
            return tag_text

        match = re.search(rf"\b{rarity_pattern}\b", tag_text)
        if match:
            return match.group(1)

        for attr_name in ["alt", "title", "data-rarity", "data-rare"]:
            attr_value = normalize_text(tag.get(attr_name, ""))
            if attr_value in RARITY_VALUES:
                return attr_value

    # 3. alt="RR" / title="C" / data-rarity="U" のような属性を厳密に見る
    attr_patterns = [
        rf'alt=["\']{rarity_pattern}["\']',
        rf'title=["\']{rarity_pattern}["\']',
        rf'data-rarity=["\']{rarity_pattern}["\']',
        rf'data-rare=["\']{rarity_pattern}["\']',
    ]

    for pattern in attr_patterns:
        match = re.search(pattern, html)
        if match:
            return match.group(1)

    # 4. ファイル名やclass名に rare_rr / rarity-c のように出る場合だけ拾う
    #    単独の "sr" は src に反応するので絶対に使わない。
    strict_html_patterns = [
        r"(?:rare|rarity|rarity_icon|icon-rare|icon_rarity)[_-]?(SAR|SR|UR|HR|AR|RR|R|U|C)",
        r"(SAR|SR|UR|HR|AR|RR|R|U|C)[_-]?(?:rare|rarity)",
    ]

    lower_html = html.lower()

    rarity_map_lower = {
        "sar": "SAR",
        "sr": "SR",
        "ur": "UR",
        "hr": "HR",
        "ar": "AR",
        "rr": "RR",
        "r": "R",
        "u": "U",
        "c": "C",
    }

    for pattern in strict_html_patterns:
        match = re.search(pattern, lower_html, flags=re.IGNORECASE)
        if match:
            value = match.group(1).lower()
            return rarity_map_lower.get(value)

    # 5. テキスト上の「レアリティ C」などを拾う
    text_match = re.search(
        r"レアリティ\s*(SAR|SR|UR|HR|AR|RR|R|U|C)",
        text,
    )
    if text_match:
        return text_match.group(1)

    return None

def detect_category(text):
    trainer_type = extract_trainer_type(text)

    if trainer_type:
        return "trainer"

    if (
        "HP" in text
        or "ワザ" in text
        or "たね" in text
        or "1進化" in text
        or "2進化" in text
    ):
        return "pokemon"

    return "unknown"


def parse_card(card_id, html, regu):
    soup = BeautifulSoup(html, "html.parser")
    text = normalize_text(soup.get_text(" "))

    name = extract_name(soup)
    set_code = extract_set_code(soup, html)
    card_no, card_no_total = extract_card_no(text)

    if not name or not set_code or not card_no:
        return None

    category = detect_category(text)
    trainer_type = extract_trainer_type(text)
    rarity = extract_rarity(soup, html, text)
    source_url = BASE_URL.format(card_id=card_id, regu=regu)

    return {
        "officialCardId": str(card_id),
        "setCode": set_code,
        "cardNo": card_no,
        "cardNoTotal": card_no_total,
        "name": name,
        "rarity": rarity,
        "category": category,
        "pokemonType": extract_pokemon_type(html) if category == "pokemon" else None,
        "trainerType": trainer_type if category == "trainer" else None,
        "evolutionStage": extract_evolution_stage(text) if category == "pokemon" else None,
        "hp": extract_hp(text),
        "packName": extract_pack_name(text),
        "sourceUrl": source_url,
    }


def sort_cards(cards):
    return sorted(
        cards,
        key=lambda card: (
            card["setCode"],
            int(card["cardNo"]) if card["cardNo"].isdigit() else 999,
            int(card["officialCardId"]),
        ),
    )


def save_cards(set_code, cards):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_file = OUTPUT_DIR / f"{set_code}.json"
    output_file.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"done: {output_file}")
    print(f"cards: {len(cards)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--set", dest="set_code", required=True)
    parser.add_argument("--regu", default=DEFAULT_REGU)
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--no-cache", action="store_true")

    args = parser.parse_args()

    cards = []

    for card_id in range(args.start, args.end + 1):
        html = fetch_html(
            card_id=card_id,
            regu=args.regu,
            use_cache=not args.no_cache,
        )

        if not html:
            continue

        card = parse_card(card_id, html, args.regu)

        if not card:
            print(f"parse failed or not card page: {card_id}")
            time.sleep(args.sleep)
            continue

        if card["setCode"] != args.set_code:
            print(
                f"skip set: {card_id} "
                f"{card['setCode']} {card['cardNo']} {card['name']}"
            )
            time.sleep(args.sleep)
            continue

        cards.append(card)
        rarity_text = card["rarity"] if card["rarity"] else "rarity未取得"
        print(f"parsed: {card['setCode']} {card['cardNo']} {card['name']} {rarity_text}")

        time.sleep(args.sleep)

    cards = sort_cards(cards)
    save_cards(args.set_code, cards)


if __name__ == "__main__":
    main()