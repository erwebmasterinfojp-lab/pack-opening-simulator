import {
  normalizeCards,
  openPacks,
  createCardSummary,
  createBoxSummary
} from "./simulator.js";

const CARD_MASTER_PATH = "./data/cards/M5.json";
const PACK_RULE_PATH = "./data/rules/M5.json";

const PLACEHOLDER_CARD_IMAGE_PATH =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="250" height="350" viewBox="0 0 250 350">
      <rect width="250" height="350" rx="18" fill="#dbeafe"/>
      <rect x="16" y="16" width="218" height="318" rx="14" fill="#eff6ff" stroke="#93c5fd" stroke-width="3"/>
      <text x="125" y="155" text-anchor="middle" font-size="22" font-family="Arial" fill="#1e3a8a" font-weight="700">POKÉCA</text>
      <text x="125" y="190" text-anchor="middle" font-size="16" font-family="Arial" fill="#475569">CARD IMAGE</text>
      <text x="125" y="220" text-anchor="middle" font-size="13" font-family="Arial" fill="#64748b">placeholder</text>
    </svg>
  `);

let cards = [];
let packRule = null;

const statusDiv = document.getElementById("status");

const boxSummaryPanel = document.getElementById("box-summary-panel");
const boxSummaryDiv = document.getElementById("box-summary");

const summaryPanel = document.getElementById("summary-panel");
const summaryDiv = document.getElementById("summary");

const resultPanel = document.getElementById("result-panel");
const resultDiv = document.getElementById("result");

const open15Button = document.getElementById("open-15-packs");
const open30Button = document.getElementById("open-30-packs");

init();

async function init() {
  try {
    setStatus("カードマスター・封入ルール読み込み中...");

    const [cardResponse, ruleResponse] = await Promise.all([
      fetch(CARD_MASTER_PATH),
      fetch(PACK_RULE_PATH)
    ]);

    if (!cardResponse.ok) {
      throw new Error(`カードマスターを読み込めませんでした: ${cardResponse.status}`);
    }

    if (!ruleResponse.ok) {
      throw new Error(`封入ルールを読み込めませんでした: ${ruleResponse.status}`);
    }

    const rawCards = await cardResponse.json();
    packRule = await ruleResponse.json();

    cards = normalizeCards(rawCards);

    setStatus(
      `読み込み完了：${cards.length}枚 / ${packRule.displayName || packRule.setCode}`,
      "success"
    );

    open15Button.disabled = false;
    open30Button.disabled = false;

    open15Button.addEventListener("click", () => handleOpenPacks(15));
    open30Button.addEventListener("click", () => handleOpenPacks(30));
  } catch (error) {
    console.error(error);

    setStatus(
      `読み込みに失敗しました：${error.message}`,
      "error"
    );
  }
}

function handleOpenPacks(packCount) {
  const packs = openPacks(cards, packCount, packRule);
  const summary = createCardSummary(packs);
  const boxSummary = createBoxSummary(packs);

  displayBoxSummary(boxSummary);
  displaySummary(summary);
  displayPacks(packs);

  boxSummaryPanel.classList.remove("hidden");
  summaryPanel.classList.remove("hidden");
  resultPanel.classList.remove("hidden");
}

function displayBoxSummary(boxSummary) {
  const entries = Object.entries(boxSummary)
    .sort((a, b) => getRarityDisplayIndex(a[0]) - getRarityDisplayIndex(b[0]));

  if (entries.length === 0) {
    boxSummaryDiv.innerHTML = "<p>封入内訳なし</p>";
    return;
  }

  boxSummaryDiv.innerHTML = `
    <div class="box-summary-list">
      ${entries.map(([rarity, count]) => {
        return `
          <div class="box-summary-item">
            ${escapeHtml(rarity)}
            <span>${escapeHtml(count)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function displaySummary(summary) {
  if (summary.length === 0) {
    summaryDiv.innerHTML = "<p>カードがありません。</p>";
    return;
  }

  summaryDiv.innerHTML = `
    <div class="summary-grid">
      ${summary.map(item => renderCardTile(item.card, item.count)).join("")}
    </div>
  `;
}

function displayPacks(packs) {
  resultDiv.innerHTML = `
    <div class="pack-list">
      ${packs.map(pack => {
        return `
          <section class="pack-card">
            <h3>${pack.packNo}パック目</h3>
            <div class="pack-grid">
              ${pack.cards.map(card => renderCardTile(card, null)).join("")}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderCardTile(card, count) {
  const cardNo = formatCardNo(card);
  const imageUrl = getCardImageUrl(card);

  return `
    <article class="card-tile image-only-card">
      <div class="card-tile__image">
        <img
          src="${escapeHtml(imageUrl)}"
          alt="${escapeHtml(card.name)}"
          title="${escapeHtml(cardNo)} ${escapeHtml(card.name)} ${escapeHtml(card.rarity || "")}"
          loading="lazy"
          onerror="this.parentElement.classList.add('is-error')"
        />

        <div class="card-tile__fallback">
          <div>
            <strong>${escapeHtml(card.rarity || "不明")}</strong><br>
            ${escapeHtml(cardNo)}<br>
            ${escapeHtml(card.name)}
          </div>
        </div>

        ${count ? `<div class="card-count-badge">×${escapeHtml(count)}</div>` : ""}
      </div>
    </article>
  `;
}

function getCardImageUrl(card) {
  return card.imageLocalPath || card.imageUrl || PLACEHOLDER_CARD_IMAGE_PATH;
}

function formatCardNo(card) {
  if (card.cardNo && card.cardNoTotal) {
    return `${card.cardNo}/${card.cardNoTotal}`;
  }

  return card.cardNo || "";
}

function setStatus(message, type = "") {
  statusDiv.textContent = message;
  statusDiv.classList.remove("is-success", "is-error");

  if (type === "success") {
    statusDiv.classList.add("is-success");
  }

  if (type === "error") {
    statusDiv.classList.add("is-error");
  }
}

function getRarityDisplayIndex(rarity) {
  const order = [
    "C",
    "U",
    "R",
    "RR",
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
    "不明"
  ];

  const index = order.indexOf(rarity);
  return index === -1 ? 999 : index;
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