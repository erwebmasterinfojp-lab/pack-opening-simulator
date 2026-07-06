import argparse
import json
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CARD_DIR = ROOT_DIR / "data" / "cards"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "manual_images"

HIGH_RARITIES = {
    "AR",
    "SR",
    "SAR",
    "UR",
    "MUR",
    "BWR",
    "MA",
    "SSR",
    "MM",
    "ACE",
    "HR",
}


def should_target_card(card: dict) -> bool:
    rarity = str(card.get("rarity", ""))
    card_no = str(card.get("cardNo", ""))
    card_total = str(card.get("cardNoTotal", ""))

    if rarity in HIGH_RARITIES:
        return True

    try:
        return int(card_no) > int(card_total)
    except ValueError:
        return False


def sanitize_filename(value: str) -> str:
    value = str(value)

    for char in ['\\', '/', ':', '*', '?', '"', '<', '>', '|']:
        value = value.replace(char, "_")

    return value.strip().replace(" ", "_")


def build_target_filename(card: dict) -> str:
    card_no = sanitize_filename(card.get("cardNo", "unknown"))
    rarity = sanitize_filename(card.get("rarity", "unknown"))
    name = sanitize_filename(card.get("name", "unknown"))
    official_card_id = sanitize_filename(card.get("officialCardId", "manual"))

    return f"{card_no}_{rarity}_{name}_{official_card_id}.jpg"


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument("--set", dest="set_code", required=True)
    parser.add_argument("--input", dest="input_file", default=None)
    parser.add_argument("--output", default=None)

    args = parser.parse_args()

    set_code = args.set_code

    card_file = (
        Path(args.input_file)
        if args.input_file
        else DEFAULT_CARD_DIR / f"{set_code}.json"
    )

    output_file = (
        Path(args.output)
        if args.output
        else DEFAULT_OUTPUT_DIR / f"{set_code}_high_rarity_image_filenames.txt"
    )

    if not card_file.exists():
        raise FileNotFoundError(f"カードマスターが見つかりません: {card_file}")

    output_file.parent.mkdir(parents=True, exist_ok=True)

    cards = json.loads(card_file.read_text(encoding="utf-8"))

    target_cards = [
        card for card in cards
        if str(card.get("setCode")) == set_code and should_target_card(card)
    ]

    lines = []

    for card in target_cards:
        card_name = str(card.get("name", ""))
        rarity = str(card.get("rarity", ""))
        card_no = str(card.get("cardNo", ""))
        filename = build_target_filename(card)

        line = f"{card_no} {card_name} {rarity}\t{filename}"
        lines.append(line)

    output_file.write_text("\n".join(lines), encoding="utf-8")

    print(f"target cards: {len(target_cards)}")
    print(f"output: {output_file}")
    print("")
    print("\n".join(lines))


if __name__ == "__main__":
    main()