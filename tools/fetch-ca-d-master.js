const fs = require("fs");
const path = require("path");

const TARGET_CARD_IDS = [50220, 50290];
const REGU = "XY";

const OUTPUT_DIR = path.join(__dirname, "../data/cards");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "M5.json");

function normalizeText(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return normalizeText(html.replace(/<[^>]*>/g, " "));
}

function extractBetween(html, startRegex, endRegex) {
  const startMatch = html.match(startRegex);
  if (!startMatch || startMatch.index === undefined) return null;

  const startIndex = startMatch.index + startMatch[0].length;
  const rest = html.slice(startIndex);
  const endMatch = rest.match(endRegex);

  if (!endMatch || endMatch.index === undefined) return rest;
  return rest.slice(0, endMatch.index);
}

function extractName(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return match ? stripTags(match[1]) : null;
}

function extractSetCodeAndCardNo(html) {
  const text = stripTags(html);
  const match = text.match(/\b([A-Z]\d+[a-zA-Z]?)\b\s+(\d{3})\s*\/\s*(\d{3})/);

  if (!match) {
    return {
      setCode: null,
      cardNo: null,
      cardNoTotal: null
    };
  }

  return {
    setCode: match[1],
    cardNo: match[2],
    cardNoTotal: match[3]
  };
}

function extractHp(html) {
  const text = stripTags(html);
  const match = text.match(/HP\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function extractPackName(html) {
  const text = stripTags(html);
  const match = text.match(/拡張パック「([^」]+)」/);
  return match ? `拡張パック「${match[1]}」` : null;
}

function extractEvolutionStage(html) {
  const text = stripTags(html);

  if (text.includes("たね")) return "たね";
  if (text.includes("1進化")) return "1進化";
  if (text.includes("2進化")) return "2進化";

  return null;
}

function extractTrainerType(html) {
  const trainerTypes = ["グッズ", "ポケモンのどうぐ", "サポート", "スタジアム"];

  for (const type of trainerTypes) {
    const regex = new RegExp(`<h2[^>]*>\\s*${type}\\s*<\\/h2>`);
    if (regex.test(html)) {
      if (type === "ポケモンのどうぐ") return "どうぐ";
      return type;
    }
  }

  return null;
}

function extractPokemonType(html) {
  const typeMap = {
    "icon-grass": "草",
    "icon-fire": "炎",
    "icon-water": "水",
    "icon-lightning": "雷",
    "icon-psychic": "超",
    "icon-fighting": "闘",
    "icon-darkness": "悪",
    "icon-metal": "鋼",
    "icon-dragon": "ドラゴン",
    "icon-colorless": "無色"
  };

  for (const [className, typeName] of Object.entries(typeMap)) {
    if (html.includes(className)) {
      return typeName;
    }
  }

  return null;
}

function detectCategory(html) {
  const trainerType = extractTrainerType(html);

  if (trainerType) return "trainer";

  const text = stripTags(html);

  if (
    text.includes("HP") ||
    text.includes("ワザ") ||
    text.includes("たね") ||
    text.includes("1進化") ||
    text.includes("2進化")
  ) {
    return "pokemon";
  }

  return "unknown";
}

function parseCard(html, officialCardId, sourceUrl) {
  const name = extractName(html);
  const { setCode, cardNo, cardNoTotal } = extractSetCodeAndCardNo(html);
  const category = detectCategory(html);
  const trainerType = extractTrainerType(html);

  return {
    officialCardId: String(officialCardId),
    setCode,
    cardNo,
    cardNoTotal,
    name,
    category,
    pokemonType: category === "pokemon" ? extractPokemonType(html) : null,
    trainerType: category === "trainer" ? trainerType : null,
    evolutionStage: category === "pokemon" ? extractEvolutionStage(html) : null,
    hp: extractHp(html),
    packName: extractPackName(html),
    sourceUrl
  };
}

async function fetchCard(cardId) {
  const url = `https://www.pokemon-card.com/card-search/details.php/card/${cardId}/regu/${REGU}`;

  console.log(`fetch: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    console.warn(`skip: ${cardId} ${response.status}`);
    return null;
  }

  const html = await response.text();
  const card = parseCard(html, cardId, url);

  if (!card.name || !card.setCode || !card.cardNo) {
    console.warn(`parse failed: ${cardId}`);
    return null;
  }

  return card;
}

async function main() {
  const cards = [];

  for (const cardId of TARGET_CARD_IDS) {
    const card = await fetchCard(cardId);

    if (card) {
      cards.push(card);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(cards, null, 2),
    "utf-8"
  );

  console.log(`done: ${OUTPUT_FILE}`);
  console.log(cards);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});