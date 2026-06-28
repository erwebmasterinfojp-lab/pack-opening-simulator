import json
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
CARD_FILE = ROOT_DIR / "data" / "cards" / "M5.json"
BACKUP_FILE = ROOT_DIR / "data" / "cards" / "M5.before_high_rarity_backup.json"

PACK_NAME = "拡張パック「アビスアイ」"
SET_CODE = "M5"
CARD_NO_TOTAL = "081"


HIGH_RARITY_CARDS = [
    {"cardNo": "082", "name": "カリキリ", "rarity": "AR"},
    {"cardNo": "083", "name": "グレンアルマ", "rarity": "AR"},
    {"cardNo": "084", "name": "トサキント", "rarity": "AR"},
    {"cardNo": "085", "name": "アシレーヌ", "rarity": "AR"},
    {"cardNo": "086", "name": "ライボルト", "rarity": "AR"},
    {"cardNo": "087", "name": "ヤドラン", "rarity": "AR"},
    {"cardNo": "088", "name": "ダダリン", "rarity": "AR"},
    {"cardNo": "089", "name": "フォクスライ", "rarity": "AR"},
    {"cardNo": "090", "name": "ザルード", "rarity": "AR"},
    {"cardNo": "091", "name": "トリデプス", "rarity": "AR"},
    {"cardNo": "092", "name": "ドデカバシ", "rarity": "AR"},
    {"cardNo": "093", "name": "シルヴァディ", "rarity": "AR"},

    {"cardNo": "094", "name": "ラランテスex", "rarity": "SR"},
    {"cardNo": "095", "name": "ホエルオーex", "rarity": "SR"},
    {"cardNo": "096", "name": "メガゼラオラex", "rarity": "SR"},
    {"cardNo": "097", "name": "メガシャンデラex", "rarity": "SR"},
    {"cardNo": "098", "name": "ラムパルドex", "rarity": "SR"},
    {"cardNo": "099", "name": "メガダークライex", "rarity": "SR"},
    {"cardNo": "100", "name": "モルペコex", "rarity": "SR"},
    {"cardNo": "101", "name": "メガドリュウズex", "rarity": "SR"},

    {"cardNo": "102", "name": "アイアンディフェンダー", "rarity": "SR"},
    {"cardNo": "103", "name": "エネルギーつけかえ", "rarity": "SR"},
    {"cardNo": "104", "name": "クラッシュハンマー", "rarity": "SR"},
    {"cardNo": "105", "name": "ダークベル", "rarity": "SR"},
    {"cardNo": "106", "name": "ごうかいボム", "rarity": "SR"},
    {"cardNo": "107", "name": "ブレイブバングル", "rarity": "SR"},
    {"cardNo": "108", "name": "カスミの元気", "rarity": "SR"},
    {"cardNo": "109", "name": "グラジオの決戦", "rarity": "SR"},
    {"cardNo": "110", "name": "サビ組のしたっぱ", "rarity": "SR"},
    {"cardNo": "111", "name": "ムク", "rarity": "SR"},

    {"cardNo": "112", "name": "メガゼラオラex", "rarity": "SAR"},
    {"cardNo": "113", "name": "メガシャンデラex", "rarity": "SAR"},
    {"cardNo": "114", "name": "メガダークライex", "rarity": "SAR"},
    {"cardNo": "115", "name": "モルペコex", "rarity": "SAR"},
    {"cardNo": "116", "name": "グラジオの決戦", "rarity": "SAR"},
    {"cardNo": "117", "name": "ムク", "rarity": "SAR"},
    {"cardNo": "118", "name": "メガダークライex", "rarity": "MUR"},
]


FALLBACK_BY_NAME = {
    "カリキリ": {"category": "pokemon", "pokemonType": "草", "trainerType": None, "evolutionStage": "たね", "hp": None},
    "グレンアルマ": {"category": "pokemon", "pokemonType": "炎", "trainerType": None, "evolutionStage": "1進化", "hp": None},
    "トサキント": {"category": "pokemon", "pokemonType": "水", "trainerType": None, "evolutionStage": "たね", "hp": None},
    "アシレーヌ": {"category": "pokemon", "pokemonType": "水", "trainerType": None, "evolutionStage": "2進化", "hp": None},
    "ライボルト": {"category": "pokemon", "pokemonType": "雷", "trainerType": None, "evolutionStage": "1進化", "hp": None},
    "ヤドラン": {"category": "pokemon", "pokemonType": "超", "trainerType": None, "evolutionStage": "1進化", "hp": None},
    "ダダリン": {"category": "pokemon", "pokemonType": "草", "trainerType": None, "evolutionStage": "たね", "hp": None},
    "フォクスライ": {"category": "pokemon", "pokemonType": "悪", "trainerType": None, "evolutionStage": "1進化", "hp": None},
    "ザルード": {"category": "pokemon", "pokemonType": "草", "trainerType": None, "evolutionStage": "たね", "hp": None},
    "トリデプス": {"category": "pokemon", "pokemonType": "鋼", "trainerType": None, "evolutionStage": "1進化", "hp": None},
    "ドデカバシ": {"category": "pokemon", "pokemonType": "無色", "trainerType": None, "evolutionStage": "2進化", "hp": None},
    "シルヴァディ": {"category": "pokemon", "pokemonType": "無色", "trainerType": None, "evolutionStage": "1進化", "hp": None},

    "アイアンディフェンダー": {"category": "trainer", "pokemonType": None, "trainerType": "グッズ", "evolutionStage": None, "hp": None},
    "エネルギーつけかえ": {"category": "trainer", "pokemonType": None, "trainerType": "グッズ", "evolutionStage": None, "hp": None},
    "クラッシュハンマー": {"category": "trainer", "pokemonType": None, "trainerType": "グッズ", "evolutionStage": None, "hp": None},
    "ダークベル": {"category": "trainer", "pokemonType": None, "trainerType": "グッズ", "evolutionStage": None, "hp": None},
    "ごうかいボム": {"category": "trainer", "pokemonType": None, "trainerType": "グッズ", "evolutionStage": None, "hp": None},
    "ブレイブバングル": {"category": "trainer", "pokemonType": None, "trainerType": "どうぐ", "evolutionStage": None, "hp": None},
    "カスミの元気": {"category": "trainer", "pokemonType": None, "trainerType": "サポート", "evolutionStage": None, "hp": None},
    "グラジオの決戦": {"category": "trainer", "pokemonType": None, "trainerType": "サポート", "evolutionStage": None, "hp": None},
    "サビ組のしたっぱ": {"category": "trainer", "pokemonType": None, "trainerType": "サポート", "evolutionStage": None, "hp": None},
    "ムク": {"category": "trainer", "pokemonType": None, "trainerType": "サポート", "evolutionStage": None, "hp": None},
}


def load_cards():
    return json.loads(CARD_FILE.read_text(encoding="utf-8"))


def save_cards(cards):
    CARD_FILE.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def backup_cards(cards):
    BACKUP_FILE.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def find_base_card(cards, name):
    candidates = [
        card for card in cards
        if card.get("name") == name
        and not card.get("isManual")
        and int(card.get("cardNo", "999")) <= 81
    ]

    if not candidates:
        return None

    rarity_priority = {
        "RR": 1,
        "R": 2,
        "U": 3,
        "C": 4,
    }

    return sorted(
        candidates,
        key=lambda card: rarity_priority.get(card.get("rarity"), 99)
    )[0]


def build_high_rarity_card(base_cards, item, official_card_id):
    base_card = find_base_card(base_cards, item["name"])
    fallback = FALLBACK_BY_NAME.get(item["name"], {})

    def value_from_base_or_fallback(key):
        if base_card and base_card.get(key) is not None:
            return base_card.get(key)
        return fallback.get(key)

    return {
        "officialCardId": str(official_card_id),
        "setCode": SET_CODE,
        "cardNo": item["cardNo"],
        "cardNoTotal": CARD_NO_TOTAL,
        "name": item["name"],
        "rarity": item["rarity"],
        "category": value_from_base_or_fallback("category"),
        "pokemonType": value_from_base_or_fallback("pokemonType"),
        "trainerType": value_from_base_or_fallback("trainerType"),
        "evolutionStage": value_from_base_or_fallback("evolutionStage"),
        "hp": value_from_base_or_fallback("hp"),
        "packName": PACK_NAME,
        "sourceUrl": None,
        "isManual": True,
        "manualReason": "公式カード検索に未掲載の高レアリティカードを手動追加",
    }


def remove_old_manual_high_rarity(cards):
    return [
        card for card in cards
        if not (
            card.get("setCode") == SET_CODE
            and (
                card.get("isManual") is True
                or str(card.get("officialCardId", "")).startswith("manual-M5-")
                or 50301 <= int(str(card.get("officialCardId", "0")).replace("manual-M5-", "0")) <= 50399
            )
        )
    ]


def sort_cards(cards):
    def card_no_number(card):
        try:
            return int(card.get("cardNo", "9999"))
        except ValueError:
            return 9999

    def official_id_number(card):
        try:
            return int(card.get("officialCardId", "999999"))
        except ValueError:
            return 999999

    return sorted(cards, key=lambda card: (card_no_number(card), official_id_number(card)))


def main():
    cards = load_cards()
    backup_cards(cards)

    cleaned_cards = remove_old_manual_high_rarity(cards)

    high_rarity_cards = []
    for index, item in enumerate(HIGH_RARITY_CARDS):
        official_card_id = 50301 + index
        high_rarity_cards.append(
            build_high_rarity_card(cleaned_cards, item, official_card_id)
        )

    merged_cards = sort_cards(cleaned_cards + high_rarity_cards)
    save_cards(merged_cards)

    print(f"backup: {BACKUP_FILE}")
    print(f"updated: {CARD_FILE}")
    print(f"base cards: {len(cleaned_cards)}")
    print(f"added high rarity cards: {len(high_rarity_cards)}")
    print(f"total cards: {len(merged_cards)}")

    not_filled = [
        card for card in high_rarity_cards
        if card.get("category") is None
    ]

    if not_filled:
        print("warning: category未補完カードがあります")
        for card in not_filled:
            print(card["cardNo"], card["name"], card["rarity"])


if __name__ == "__main__":
    main()