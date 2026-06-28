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
    "icon-electric": "雷",
    "icon-psychic": "超",
    "icon-fighting": "闘",
    "icon-darkness": "悪",
    "icon-dark": "悪",
    "icon-metal": "鋼",
    "icon-steel": "鋼",
    "icon-dragon": "ドラゴン",
    "icon-colorless": "無色",
    "icon-none": "無色"
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

def extract_card_area(soup):
    """
    カード詳細ページ全体のうち、カード本体情報が入っていそうな範囲を返す。

    公式ページには、検索UI・関連表示・ナビゲーションなどにも
    タイプ名やグッズ等の文字列が出る可能性がある。
    そのため、h1から親方向にたどり、カード番号 001 / 081 のような
    表記を含む最小の親要素をカード本体エリアとして扱う。
    """
    h1 = soup.find("h1")

    if not h1:
        return soup

    for parent in h1.parents:
        parent_text = normalize_text(parent.get_text(" "))

        if re.search(r"\d{3}\s*/\s*\d{3}", parent_text):
            return parent

    return h1.parent or soup


def find_type_icons_in_html(html):
    """
    HTML断片の中からタイプアイコンclassを探す。
    戻り値は [(出現位置, タイプ名), ...]
    """
    results = []

    for class_name, type_name in TYPE_CLASS_MAP.items():
        pattern = (
            r'class=["\'][^"\']*'
            + re.escape(class_name)
            + r'[^"\']*["\']'
        )

        for match in re.finditer(pattern, html):
            results.append((match.start(), type_name))

    return sorted(results, key=lambda item: item[0])

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

def type_name_from_tag(tag):
    """
    span class="icon-none icon" のようなタグからタイプ名を取得する。
    """
    class_values = tag.get("class", [])

    for class_name in class_values:
        if class_name in TYPE_CLASS_MAP:
            return TYPE_CLASS_MAP[class_name]

    return None


def is_near_same_area(base_tag, target_tag):
    """
    hp-type の直後にあるタイプアイコンかどうかをざっくり判定する。

    弱点・抵抗力テーブル側のアイコンまで find_next で飛んだ場合に
    誤って拾わないようにするための保険。
    """
    base_parent = base_tag.parent
    target_parent = target_tag.parent

    if base_parent is None or target_parent is None:
        return False

    return base_parent == target_parent


def extract_pokemon_type(card_area):
    """
    ポケモンタイプを取得する。

    公式HTMLでは、カード本体タイプは以下のように TopInfo 内に出る。

    <span class="hp-type">タイプ</span>
    <span class="icon-none icon"></span>

    一方で、弱点・抵抗力・にげるにも icon-electric / icon-fighting / icon-none 等が出る。
    そのため、HTML全体やRightBox全体から最初のアイコンを拾うと誤判定する。

    優先順位：
    1. .TopInfo .td-r 内のタイプアイコン
    2. .hp-type の直後付近のタイプアイコン
    3. フォールバックとしてカードエリア内のアイコン
    """

    # 1. TopInfoのタイプ欄を最優先で見る
    top_info = card_area.select_one(".TopInfo .td-r")

    if top_info:
        icons = top_info.find_all("span", class_="icon")

        for icon in icons:
            type_name = type_name_from_tag(icon)
            if type_name:
                return type_name

    # 2. hp-type「タイプ」の直後にあるアイコンを探す
    hp_type = card_area.find("span", class_="hp-type")

    if hp_type:
        next_icon = hp_type.find_next("span", class_="icon")

        # 弱点テーブル側まで飛ぶのを避けるため、親要素が近いものだけ採用
        if next_icon and is_near_same_area(hp_type, next_icon):
            type_name = type_name_from_tag(next_icon)
            if type_name:
                return type_name

    # 3. フォールバック：カードエリア内のTopInfoだけを再確認
    top_info = card_area.select_one(".TopInfo")

    if top_info:
        for icon in top_info.find_all("span", class_="icon"):
            type_name = type_name_from_tag(icon)
            if type_name:
                return type_name

    return None

def extract_trainer_type(card_area):
    """
    トレーナーズ種別を取得する。

    以前の実装ではページ全体のテキストに「グッズ」が含まれるだけで
    trainer扱いにしていたため、ポケモンカードがグッズ判定されることがあった。

    この実装では、カード本体エリア内の見出し・短いラベルだけを対象にする。
    """
    trainer_types = [
        ("スタジアム", "スタジアム"),
        ("ポケモンのどうぐ", "どうぐ"),
        ("どうぐ", "どうぐ"),
        ("サポート", "サポート"),
        ("グッズ", "グッズ"),
    ]

    # 見出し・ラベル系タグを優先
    target_tags = card_area.find_all(
        ["h2", "h3", "h4", "dt", "dd", "span", "p", "div"]
    )

    for tag in target_tags:
        tag_text = normalize_text(tag.get_text(" "))

        # 長文に含まれる「グッズ」等は誤判定の原因なので除外
        if len(tag_text) > 20:
            continue

        for keyword, trainer_type in trainer_types:
            if tag_text == keyword:
                return trainer_type

    # フォールバック：
    # かなり短いテキスト内にだけ含まれる場合は採用
    for tag in target_tags:
        tag_text = normalize_text(tag.get_text(" "))

        if len(tag_text) > 20:
            continue

        for keyword, trainer_type in trainer_types:
            if keyword in tag_text:
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

def detect_category(card_area, text):
    """
    カード分類を判定する。

    trainer判定は、カード本体エリア内の明確なトレーナーズ種別に限定する。
    """
    trainer_type = extract_trainer_type(card_area)

    if trainer_type:
        return "trainer"

    # ポケモンカードはHPやワザ、進化区分を持つ
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
    card_area = extract_card_area(soup)
    text = normalize_text(card_area.get_text(" "))

    name = extract_name(soup)
    set_code = extract_set_code(soup, html)
    card_no, card_no_total = extract_card_no(text)

    if not name or not set_code or not card_no:
        return None

    category = detect_category(card_area, text)
    trainer_type = extract_trainer_type(card_area)
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
        "pokemonType": extract_pokemon_type(card_area) if category == "pokemon" else None,
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