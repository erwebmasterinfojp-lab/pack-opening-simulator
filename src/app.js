import {
  normalizeCards,
  openPacks,
  createCardSummary,
  createBoxSummary
} from "./simulator.js";

const SET_INDEX_PATH = "./data/sets/index.json";

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

const RARITY_FILTER_ORDER = [
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

const POKEMON_TYPE_ORDER = [
  "草",
  "炎",
  "水",
  "雷",
  "超",
  "闘",
  "悪",
  "鋼",
  "ドラゴン",
  "無色"
];

const TRAINER_TYPE_ORDER = [
  "グッズ",
  "どうぐ",
  "サポート",
  "スタジアム"
];

let sets = [];
let selectedSet = null;
let cards = [];
let packRule = null;
let currentPacks = [];

const activeRarityFilters = new Set();
const activeKindFilters = new Set();

const setListDiv = document.getElementById("set-list");
const statusDiv = document.getElementById("status");

const filterPanel = document.getElementById("filter-panel");
const rarityFilterButtonsDiv = document.getElementById("rarity-filter-buttons");
const pokemonTypeFilterButtonsDiv = document.getElementById("pokemon-type-filter-buttons");
const trainerTypeFilterButtonsDiv = document.getElementById("trainer-type-filter-buttons");
const otherFilterButtonsDiv = document.getElementById("other-filter-buttons");

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
    setStatus("パックシリーズ読み込み中...");

    const response = await fetch(SET_INDEX_PATH);

    if (!response.ok) {
      throw new Error(`パックシリーズ一覧を読み込めませんでした: ${response.status}`);
    }

    sets = await response.json();

    if (!Array.isArray(sets) || sets.length === 0) {
      throw new Error("パックシリーズが登録されていません。");
    }

    renderSetList();

    await selectSet(sets[0].setCode);
  } catch (error) {
    console.error(error);
    setStatus(`読み込みに失敗しました：${error.message}`, "error");
  }
}

function renderSetList() {
  setListDiv.innerHTML = sets.map(set => {
    const isActive = selectedSet?.setCode === set.setCode;
    const imageUrl = set.thumbnailPath || PLACEHOLDER_CARD_IMAGE_PATH;

    return `
      <button
        type="button"
        class="set-card-button ${isActive ? "is-active" : ""}"
        data-set-code="${escapeHtml(set.setCode)}"
      >
        <div class="set-card__image">
          <img
            src="${escapeHtml(imageUrl)}"
            alt="${escapeHtml(set.displayName)}"
            onerror="this.parentElement.classList.add('is-error')"
          />
          <div class="card-tile__fallback">
            ${escapeHtml(set.displayName)}
          </div>
        </div>

        <div class="set-card__body">
          <h3>${escapeHtml(set.displayName)}</h3>
          <p>${escapeHtml(set.description || "")}</p>
        </div>
      </button>
    `;
  }).join("");

  setListDiv.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      selectSet(button.dataset.setCode);
    });
  });
}

async function selectSet(setCode) {
  const nextSet = sets.find(set => set.setCode === setCode);

  if (!nextSet) {
    setStatus(`パックシリーズが見つかりません：${setCode}`, "error");
    return;
  }

  selectedSet = nextSet;
  renderSetList();

  resetOpeningState();
  disableOpenButtons();

  try {
    setStatus(`${nextSet.displayName} のカードマスター・封入ルール読み込み中...`);

    const cardResponse = await fetch(nextSet.cardMasterPath);
    if (!cardResponse.ok) {
      throw new Error(`カードマスターを読み込めませんでした: ${cardResponse.status}`);
    }

    const ruleResponse = await fetch(nextSet.rulePath);
    if (!ruleResponse.ok) {
      throw new Error(`封入ルールを読み込めませんでした: ${ruleResponse.status}`);
    }

    const rawCards = await cardResponse.json();
    const rawRule = await ruleResponse.json();

    cards = normalizeCards(rawCards);
    packRule = rawRule;

    clearFilters();
    renderFilterButtons();

    enableOpenButtons();

    open15Button.onclick = () => handleOpenPacks(15);
    open30Button.onclick = () => handleOpenPacks(30);

    // 読み込み成功時はステータス欄を完全に消す
    hideStatus();
  } catch (error) {
    console.error(error);
    setStatus(`${nextSet.displayName} の読み込みに失敗しました：${error.message}`, "error");
  }
}

function resetOpeningState() {
  currentPacks = [];
  cards = [];
  packRule = null;

  activeRarityFilters.clear();
  activeKindFilters.clear();

  filterPanel.classList.add("hidden");
  boxSummaryPanel.classList.add("hidden");
  summaryPanel.classList.add("hidden");
  resultPanel.classList.add("hidden");

  boxSummaryDiv.innerHTML = "";
  summaryDiv.innerHTML = "";
  resultDiv.innerHTML = "";
}

function disableOpenButtons() {
  open15Button.disabled = true;
  open30Button.disabled = true;
}

function enableOpenButtons() {
  open15Button.disabled = false;
  open30Button.disabled = false;
}

function handleOpenPacks(packCount) {
  currentPacks = openPacks(cards, packCount, packRule);

  filterPanel.classList.remove("hidden");
  boxSummaryPanel.classList.remove("hidden");
  summaryPanel.classList.remove("hidden");
  resultPanel.classList.remove("hidden");

  updateDisplayedResults();
}

function updateDisplayedResults() {
  // フィルターはカード別集計のみ適用
  const filteredPacksForSummary = filterPacks(currentPacks);
  const summary = createCardSummary(filteredPacksForSummary);

  // BOX封入内訳・Pack Resultは常に全体表示
  const boxSummary = createBoxSummary(currentPacks);

  displayBoxSummary(boxSummary);
  displaySummary(summary);
  displayPacks(currentPacks);
}

function renderFilterButtons() {
  renderRarityFilterButtons();
  renderKindFilterButtons();
}

function renderRarityFilterButtons() {
  const availableRarities = new Set(cards.map(card => card.rarity || "不明"));

  const rarities = RARITY_FILTER_ORDER.filter(rarity => {
    return availableRarities.has(rarity);
  });

  rarityFilterButtonsDiv.innerHTML = rarities.map(rarity => {
    const isActive = activeRarityFilters.has(rarity);

    return `
      <button
        type="button"
        class="filter-chip ${isActive ? "is-active" : ""}"
        data-filter-value="${escapeHtml(rarity)}"
      >
        ${escapeHtml(rarity)}
      </button>
    `;
  }).join("");

  rarityFilterButtonsDiv.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      toggleSetValue(activeRarityFilters, button.dataset.filterValue);
      renderRarityFilterButtons();
      updateDisplayedResultsIfOpened();
    });
  });
}

function renderKindFilterButtons() {
  const availableKindKeys = new Set(cards.map(card => getCardKindKey(card)));

  const pokemonTypes = POKEMON_TYPE_ORDER
    .map(type => ({
      label: type,
      key: `pokemon:${type}`
    }))
    .filter(item => availableKindKeys.has(item.key));

  pokemonTypeFilterButtonsDiv.innerHTML = pokemonTypes.map(item => {
    return renderKindFilterButton(item.label, item.key);
  }).join("");

  const trainerTypes = TRAINER_TYPE_ORDER
    .map(type => ({
      label: type,
      key: `trainer:${type}`
    }))
    .filter(item => availableKindKeys.has(item.key));

  trainerTypeFilterButtonsDiv.innerHTML = trainerTypes.map(item => {
    return renderKindFilterButton(item.label, item.key);
  }).join("");

  const otherFilters = [];

  if (availableKindKeys.has("energy")) {
    otherFilters.push({
      label: "エネルギー",
      key: "energy"
    });
  }

  if (availableKindKeys.has("unknown")) {
    otherFilters.push({
      label: "不明",
      key: "unknown"
    });
  }

  otherFilterButtonsDiv.innerHTML = otherFilters.map(item => {
    return renderKindFilterButton(item.label, item.key);
  }).join("");

  [
    pokemonTypeFilterButtonsDiv,
    trainerTypeFilterButtonsDiv,
    otherFilterButtonsDiv
  ].forEach(container => {
    container.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        toggleSetValue(activeKindFilters, button.dataset.filterValue);
        renderKindFilterButtons();
        updateDisplayedResultsIfOpened();
      });
    });
  });
}

function renderKindFilterButton(label, key) {
  const isActive = activeKindFilters.has(key);

  return `
    <button
      type="button"
      class="filter-chip ${isActive ? "is-active" : ""}"
      data-filter-value="${escapeHtml(key)}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function updateDisplayedResultsIfOpened() {
  if (currentPacks.length === 0) {
    return;
  }

  updateDisplayedResults();
}

function toggleSetValue(targetSet, value) {
  if (targetSet.has(value)) {
    targetSet.delete(value);
  } else {
    targetSet.add(value);
  }
}

function clearFilters() {
  activeRarityFilters.clear();
  activeKindFilters.clear();
}

function filterPacks(packs) {
  return packs
    .map(pack => {
      return {
        ...pack,
        cards: pack.cards.filter(card => matchesActiveFilters(card))
      };
    })
    .filter(pack => pack.cards.length > 0);
}

function matchesActiveFilters(card) {
  const rarityMatches =
    activeRarityFilters.size === 0 ||
    activeRarityFilters.has(card.rarity || "不明");

  const kindMatches =
    activeKindFilters.size === 0 ||
    activeKindFilters.has(getCardKindKey(card));

  return rarityMatches && kindMatches;
}

function getCardKindKey(card) {
  if (card.category === "pokemon") {
    return `pokemon:${card.pokemonType || "不明"}`;
  }

  if (card.category === "trainer") {
    return `trainer:${card.trainerType || "不明"}`;
  }

  if (card.category === "energy") {
    return "energy";
  }

  return "unknown";
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
    summaryDiv.innerHTML = "<p>条件に一致するカードがありません。</p>";
    return;
  }

  summaryDiv.innerHTML = `
    <div class="summary-grid">
      ${summary.map(item => renderCardTile(item.card, item.count)).join("")}
    </div>
  `;
}

function displayPacks(packs) {
  if (packs.length === 0) {
    resultDiv.innerHTML = "<p>開封結果がありません。</p>";
    return;
  }

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
  statusDiv.classList.remove("hidden", "is-success", "is-error");

  if (type === "success") {
    statusDiv.classList.add("is-success");
  }

  if (type === "error") {
    statusDiv.classList.add("is-error");
  }
}

function hideStatus() {
  statusDiv.textContent = "";
  statusDiv.classList.add("hidden");
}

function getRarityDisplayIndex(rarity) {
  const index = RARITY_FILTER_ORDER.indexOf(rarity);
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