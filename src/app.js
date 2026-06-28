import {
  normalizeCards,
  openPacks,
  createCardSummary
} from "./simulator.js";

const CARD_MASTER_PATH = "./data/cards/M5.json";
const PACK_RULE_PATH = "./data/rules/M5.json";

let cards = [];
let packRule = null;

const statusDiv = document.getElementById("status");
const summaryDiv = document.getElementById("summary");
const resultDiv = document.getElementById("result");

const open15Button = document.getElementById("open-15-packs");
const open30Button = document.getElementById("open-30-packs");

init();

async function init() {
  try {
    statusDiv.textContent = "カードマスター・封入ルール読み込み中...";

    const [cardResponse, ruleResponse] = await Promise.all([
      fetch(CARD_MASTER_PATH),
      fetch(PACK_RULE_PATH)
    ]);

    if (!cardResponse.ok) {
      throw new Error(`M5.jsonを読み込めませんでした: ${cardResponse.status}`);
    }

    if (!ruleResponse.ok) {
      throw new Error(`封入ルールを読み込めませんでした: ${ruleResponse.status}`);
    }

    const rawCards = await cardResponse.json();
    packRule = await ruleResponse.json();

    cards = normalizeCards(rawCards);

    statusDiv.innerHTML = `
      <p>カードマスター読み込み完了：${cards.length}枚</p>
      <p>封入ルール：${escapeHtml(packRule.displayName)}</p>
    `;

    open15Button.disabled = false;
    open30Button.disabled = false;

    open15Button.addEventListener("click", () => handleOpenPacks(15));
    open30Button.addEventListener("click", () => handleOpenPacks(30));
  } catch (error) {
    console.error(error);

    statusDiv.innerHTML = `
      <p style="color: red;">
        読み込みに失敗しました。<br>
        ${escapeHtml(error.message)}
      </p>
      <p>
        ローカル確認の場合は、VSCodeのLive Serverから開いてください。
      </p>
    `;
  }
}

function handleOpenPacks(packCount) {
  const packs = openPacks(cards, packCount, packRule);
  const summary = createCardSummary(packs);

  displaySummary(summary);
  displayPacks(packs);
}

function displaySummary(summary) {
  let html = "<h2>カード別集計</h2>";
  html += "<ul>";

  summary.forEach(item => {
    const card = item.card;

    html += `
      <li>
        ${escapeHtml(formatCardNo(card))}
        ${escapeHtml(card.name)}
        ${escapeHtml(card.rarity)}
        ${renderCardInfo(card)}
        ：${item.count}枚
      </li>
    `;
  });

  html += "</ul>";

  summaryDiv.innerHTML = html;
}

function displayPacks(packs) {
  resultDiv.innerHTML = packs.map(pack => {
    return `
      <section>
        <h3>${pack.packNo}パック目</h3>
        <ul>
          ${pack.cards.map(card => {
            return `
              <li>
                ${escapeHtml(formatCardNo(card))}
                ${escapeHtml(card.name)}
                ${escapeHtml(card.rarity)}
                ${renderCardInfo(card)}
              </li>
            `;
          }).join("")}
        </ul>
      </section>
    `;
  }).join("");
}

function formatCardNo(card) {
  if (card.cardNoTotal) {
    return `${card.cardNo}/${card.cardNoTotal}`;
  }

  return card.cardNo || "";
}

function renderCardInfo(card) {
  if (card.category === "pokemon") {
    return ` / ${escapeHtml(card.pokemonType || "")} / ${escapeHtml(card.evolutionStage || "")}`;
  }

  if (card.category === "trainer") {
    return ` / ${escapeHtml(card.trainerType || "")}`;
  }

  if (card.category === "energy") {
    return " / エネルギー";
  }

  return "";
}

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}