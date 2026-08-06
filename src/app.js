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

const EXPORT_HIGH_RARITIES = new Set([
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
  "HR"
]);

let sets = [];
let selectedSet = null;
let cards = [];
let packRule = null;
let currentPacks = [];
let latestSummaryItems = [];
let latestSelectedSetName = "";

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

const preOpeningAd = document.getElementById("pre-opening-ad");
const preOpeningAdContinue = document.getElementById("pre-opening-ad-continue");
const preOpeningAdCountdown = document.getElementById("pre-opening-ad-countdown");

const openingOverlay = document.getElementById("opening-overlay");
const openingOverlayTitle = document.getElementById("opening-overlay-title");
const openingOverlayText = document.getElementById("opening-overlay-text");

const PRE_OPENING_AD_SECONDS = 3;
const OPENING_ANIMATION_MS = 2000;

let isOpeningAnimationRunning = false;

const open15Button = document.getElementById("open-15-packs");
const open30Button = document.getElementById("open-30-packs");

const cardModal = document.getElementById("card-modal");
const cardModalImage = document.getElementById("card-modal-image");
const cardModalCaption = document.getElementById("card-modal-caption");
const cardModalClose = document.getElementById("card-modal-close");

const exportHighRareImageButton =
  document.getElementById("export-high-rare-image");

const exportAllCardsImageButton =
  document.getElementById("export-all-cards-image");

init();

async function init() {
  try {
    setStatus("パックシリーズ読み込み中...");

    const response = await fetch(SET_INDEX_PATH);

    if (!response.ok) {
      throw new Error(`パックシリーズ一覧を読み込めませんでした: ${response.status}`);
    }

    const loadedSets = await response.json();

    if (!Array.isArray(loadedSets) || loadedSets.length === 0) {
      throw new Error("パックシリーズが登録されていません。");
    }
    
    // M6 → M5 → M4 のように、新しいパックから降順で並べる
    sets = [...loadedSets].sort(compareSetsNewestFirst);
    
    renderSetList();
    
    // 降順ソート後の先頭、つまり最新パックをデフォルト選択
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
          <!-- <p>${escapeHtml(set.description || "")}</p> -->
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

function compareSetsNewestFirst(a, b) {
  const aNumber = getSetCodeNumber(a.setCode);
  const bNumber = getSetCodeNumber(b.setCode);

  // 数字部分を降順にする
  if (aNumber !== bNumber) {
    return bNumber - aNumber;
  }

  // 数字が同じ、または数字を取得できない場合の予備比較
  return String(b.setCode || "").localeCompare(
    String(a.setCode || ""),
    "ja",
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}

function getSetCodeNumber(setCode) {
  const match = String(setCode || "").match(/\d+/);

  if (!match) {
    return -1;
  }

  return Number(match[0]);
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

  updateSummaryExportButtons();
}

function disableOpenButtons() {
  open15Button.disabled = true;
  open30Button.disabled = true;
}

function enableOpenButtons() {
  open15Button.disabled = false;
  open30Button.disabled = false;
}

async function handleOpenPacks(packCount) {
  if (isOpeningAnimationRunning) {
    return;
  }

  isOpeningAnimationRunning = true;
  disableOpenButtons();

  try {
    // 結果は先に生成しておくが、演出終了まで表示しない
    currentPacks = openPacks(cards, packCount, packRule);

    filterPanel.classList.add("hidden");
    boxSummaryPanel.classList.add("hidden");
    summaryPanel.classList.add("hidden");
    resultPanel.classList.add("hidden");

    // await showPreOpeningAd(); 自前のパック開封前広告を削除
    await playOpeningAnimation(packCount);

    filterPanel.classList.remove("hidden");
    boxSummaryPanel.classList.remove("hidden");
    summaryPanel.classList.remove("hidden");
    resultPanel.classList.remove("hidden");

    updateDisplayedResults();
  } finally {
    enableOpenButtons();
    isOpeningAnimationRunning = false;
  }
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

// 自前のパック開封前広告を削除
// async function showPreOpeningAd() {
//   if (!preOpeningAd || !preOpeningAdContinue) {
//     return;
//   }

//   preOpeningAd.classList.remove("hidden");
//   preOpeningAd.setAttribute("aria-hidden", "false");
//   document.body.classList.add("modal-open");

//   preOpeningAdContinue.disabled = true;

//   for (let seconds = PRE_OPENING_AD_SECONDS; seconds > 0; seconds -= 1) {
//     if (preOpeningAdCountdown) {
//       preOpeningAdCountdown.textContent =
//         `ローディング中...${seconds}`;
//     }

//     await wait(1000);
//   }

//   if (preOpeningAdCountdown) {
//     preOpeningAdCountdown.textContent =
//       "準備完了！";
//   }

//   preOpeningAdContinue.disabled = false;

//   await new Promise(resolve => {
//     const handleClick = () => {
//       preOpeningAdContinue.removeEventListener("click", handleClick);

//       preOpeningAd.classList.add("hidden");
//       preOpeningAd.setAttribute("aria-hidden", "true");
//       document.body.classList.remove("modal-open");

//       resolve();
//     };

//     preOpeningAdContinue.addEventListener("click", handleClick);
//   });
// }

async function playOpeningAnimation(packCount) {
  if (!openingOverlay) {
    return;
  }

  const isBoxOpening = packCount >= 30;

  if (openingOverlayTitle) {
    openingOverlayTitle.textContent = isBoxOpening
      ? "1BOX開封中..."
      : "15パック開封中...";
  }

  if (openingOverlayText) {
    openingOverlayText.textContent = isBoxOpening
      ? "BOXの中身を確認しています..."
      : "15パックを開封しています...";
  }

  openingOverlay.classList.remove("hidden", "is-finishing");
  openingOverlay.classList.add("is-playing");
  openingOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  await wait(OPENING_ANIMATION_MS);

  openingOverlay.classList.add("is-finishing");

  await wait(450);

  openingOverlay.classList.remove("is-playing", "is-finishing");
  openingOverlay.classList.add("hidden");
  openingOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
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
  updateSummaryExportButtons();
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
    summaryDiv.innerHTML =
      "<p>条件に一致するカードがありません。</p>";
    return;
  }

  // カード番号が分母より大きいカード。
  // AR、SR、SAR、MURなどのシークレット番号カードが該当する。
  const secretNumberedCards = summary
    .filter(item => isSecretNumberedCard(item.card))
    .sort((a, b) => {
      const cardNoDiff =
        getCardNoNumber(b.card) - getCardNoNumber(a.card);

      if (cardNoDiff !== 0) {
        return cardNoDiff;
      }

      return String(a.card.name || "")
        .localeCompare(String(b.card.name || ""), "ja");
    });

  // 通常のカード番号。
  // カード番号の小さい順に並べる。
  const regularNumberedCards = summary
    .filter(item => !isSecretNumberedCard(item.card))
    .sort((a, b) => {
      const cardNoDiff =
        getCardNoNumber(a.card) - getCardNoNumber(b.card);

      if (cardNoDiff !== 0) {
        return cardNoDiff;
      }

      return String(a.card.name || "")
        .localeCompare(String(b.card.name || ""), "ja");
    });

  const secretHtml = secretNumberedCards.length > 0
    ? `
      <div class="summary-grid summary-grid--secret">
        ${secretNumberedCards
          .map(item => renderCardTile(item.card, item.count))
          .join("")}
      </div>
    `
    : "";

  const regularHtml = regularNumberedCards.length > 0
    ? `
      <div class="summary-grid summary-grid--regular">
        ${regularNumberedCards
          .map(item => renderCardTile(item.card, item.count))
          .join("")}
      </div>
    `
    : "";

  summaryDiv.innerHTML = `
    <div class="summary-card-groups">
      ${secretHtml}
      ${regularHtml}
    </div>
  `;
}

function isSecretNumberedCard(card) {
  const cardNo = getCardNoNumber(card);
  const cardNoTotal = getCardNoTotalNumber(card);

  if (!Number.isFinite(cardNo)) {
    return false;
  }

  if (!Number.isFinite(cardNoTotal)) {
    return false;
  }

  return cardNo > cardNoTotal;
}

function getCardNoNumber(card) {
  return parseCardNumber(card?.cardNo);
}

function getCardNoTotalNumber(card) {
  return parseCardNumber(card?.cardNoTotal);
}

function parseCardNumber(value) {
  if (value === null || value === undefined || value === "") {
    return Number.NaN;
  }

  // "082" → 82
  // "082a" のような値が来ても先頭の数値を使用する
  const match = String(value).match(/\d+/);

  if (!match) {
    return Number.NaN;
  }

  return Number(match[0]);
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
  const label = `${cardNo} ${card.name} ${card.rarity || ""}`.trim();

  return `
    <article
      class="card-tile image-only-card"
      data-card-image-url="${escapeHtml(imageUrl)}"
      data-card-label="${escapeHtml(label)}"
      tabindex="0"
      role="button"
      aria-label="${escapeHtml(label)}を拡大表示"
    >
      <div class="card-tile__image">
        <img
          src="${escapeHtml(imageUrl)}"
          alt="${escapeHtml(card.name)}"
          title="${escapeHtml(label)}"
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

function openCardModalFromTile(tile) {
  const imageUrl = tile.dataset.cardImageUrl;
  const label = tile.dataset.cardLabel || "";

  if (!imageUrl) {
    return;
  }

  cardModalImage.src = imageUrl;
  cardModalImage.alt = label;
  cardModalCaption.textContent = label;

  cardModal.classList.remove("hidden");
  cardModal.setAttribute("aria-hidden", "false");

  document.body.classList.add("modal-open");
}

function closeCardModal() {
  cardModal.classList.add("hidden");
  cardModal.setAttribute("aria-hidden", "true");

  cardModalImage.src = "";
  cardModalImage.alt = "";
  cardModalCaption.textContent = "";

  document.body.classList.remove("modal-open");
}

function handleCardTileClick(event) {
  const tile = event.target.closest(".card-tile.image-only-card");

  if (!tile) {
    return;
  }

  openCardModalFromTile(tile);
}

function handleCardTileKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const tile = event.target.closest(".card-tile.image-only-card");

  if (!tile) {
    return;
  }

  event.preventDefault();
  openCardModalFromTile(tile);
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


function updateSummaryExportButtons() {
  const hasResults = currentPacks.length > 0;

  if (exportHighRareImageButton) {
    exportHighRareImageButton.disabled = !hasResults;
  }

  if (exportAllCardsImageButton) {
    exportAllCardsImageButton.disabled = !hasResults;
  }
}

async function exportOpenedCardsImage({
  onlyHighRare,
  button
}) {
  if (!button || currentPacks.length === 0) {
    return;
  }

  const originalText = button.textContent;

  try {
    button.disabled = true;
    button.textContent = "生成中...";

    const allSummaryItems = createCardSummary(currentPacks);
    const targetItems = sortSummaryItemsForExport(
      onlyHighRare
        ? allSummaryItems.filter(item => {
            return isExportHighRareCard(item.card);
          })
        : allSummaryItems
    );

    if (targetItems.length === 0) {
      alert("画像へ出力できるカードがありません。");
      return;
    }

    const imageBlob = await createSummaryImageBlob(
      targetItems,
      onlyHighRare
    );

    if (!imageBlob) {
      throw new Error("画像データを生成できませんでした。");
    }

    const objectUrl = URL.createObjectURL(imageBlob);
    const link = document.createElement("a");
    const modeName = onlyHighRare
      ? "ハイレア一覧"
      : "全カード一覧";

    link.href = objectUrl;
    link.download = [
      sanitizeExportFileName(
        selectedSet?.displayName || "開封結果"
      ),
      currentPacks.length + "パック",
      modeName
    ].join("_") + ".png";

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  } catch (error) {
    console.error(error);
    alert(
      `一覧画像の生成に失敗しました：${error.message}`
    );
  } finally {
    button.textContent = originalText;
    updateSummaryExportButtons();
  }
}

function sortSummaryItemsForExport(summaryItems) {
  const secretItems = summaryItems
    .filter(item => isSecretNumberedCard(item.card))
    .sort((a, b) => {
      const numberDiff =
        getCardNoNumber(b.card) -
        getCardNoNumber(a.card);

      if (numberDiff !== 0) {
        return numberDiff;
      }

      return String(a.card.name || "")
        .localeCompare(String(b.card.name || ""), "ja");
    });

  const regularItems = summaryItems
    .filter(item => !isSecretNumberedCard(item.card))
    .sort((a, b) => {
      const numberDiff =
        getCardNoNumber(a.card) -
        getCardNoNumber(b.card);

      if (numberDiff !== 0) {
        return numberDiff;
      }

      return String(a.card.name || "")
        .localeCompare(String(b.card.name || ""), "ja");
    });

  return [
    ...secretItems,
    ...regularItems
  ];
}

function isExportHighRareCard(card) {
  return (
    EXPORT_HIGH_RARITIES.has(
      String(card.rarity || "")
    ) ||
    isSecretNumberedCard(card)
  );
}

async function createSummaryImageBlob(
  summaryItems,
  onlyHighRare
) {
  const layout = onlyHighRare
    ? {
        columns: 4,
        cardWidth: 250,
        cardHeight: 350,
        cellWidth: 286,
        cellHeight: 424,
        columnGap: 24,
        rowGap: 26,
        nameFontSize: 20,
        infoFontSize: 15,
        countFontSize: 24
      }
    : {
        columns: 6,
        cardWidth: 170,
        cardHeight: 238,
        cellWidth: 194,
        cellHeight: 316,
        columnGap: 18,
        rowGap: 22,
        nameFontSize: 15,
        infoFontSize: 12,
        countFontSize: 19
      };

  const padding = 48;
  const headerHeight = 148;
  const footerHeight = 56;
  const rows = Math.ceil(
    summaryItems.length / layout.columns
  );

  const logicalWidth =
    padding * 2 +
    layout.columns * layout.cellWidth +
    (layout.columns - 1) * layout.columnGap;

  const logicalHeight =
    headerHeight +
    rows * layout.cellHeight +
    Math.max(0, rows - 1) * layout.rowGap +
    footerHeight +
    padding;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * scale;
  canvas.height = logicalHeight * scale;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvasを初期化できませんでした。");
  }

  context.scale(scale, scale);
  context.fillStyle = "#f3f6fb";
  context.fillRect(0, 0, logicalWidth, logicalHeight);

  drawExportHeader(
    context,
    logicalWidth,
    onlyHighRare,
    summaryItems.length
  );

  const loadedImages = await Promise.all(
    summaryItems.map(item => {
      return loadExportCardImage(
        getCardImageUrl(item.card)
      );
    })
  );

  summaryItems.forEach((item, index) => {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const x =
      padding +
      column * (layout.cellWidth + layout.columnGap);
    const y =
      headerHeight +
      row * (layout.cellHeight + layout.rowGap);

    drawExportCard(
      context,
      item,
      loadedImages[index],
      x,
      y,
      layout
    );
  });

  context.fillStyle = "#75839b";
  context.font =
    '600 14px "Noto Sans JP", "Yu Gothic", sans-serif';
  context.textAlign = "right";
  context.fillText(
    "Pack Opening Simulator",
    logicalWidth - padding,
    logicalHeight - 22
  );

  return canvasToBlob(canvas);
}

function drawExportHeader(
  context,
  canvasWidth,
  onlyHighRare,
  itemCount
) {
  const packName =
    selectedSet?.displayName ||
    packRule?.displayName ||
    "開封結果";

  const title = onlyHighRare
    ? `${packName} ハイレア一覧`
    : `${packName} 出現カード一覧`;

  const subtitle = [
    `${currentPacks.length}パック開封`,
    `${itemCount}種類`,
    "カード右上の数字は出現枚数"
  ].join(" / ");

  context.fillStyle = "#1a2740";
  context.font =
    '800 34px "Noto Sans JP", "Yu Gothic", sans-serif';
  context.textAlign = "left";
  context.fillText(title, 48, 58);

  context.fillStyle = "#5f6f89";
  context.font =
    '600 17px "Noto Sans JP", "Yu Gothic", sans-serif';
  context.fillText(subtitle, 48, 96);

  context.strokeStyle = "#d7deea";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(48, 124);
  context.lineTo(canvasWidth - 48, 124);
  context.stroke();
}

function drawExportCard(
  context,
  item,
  image,
  x,
  y,
  layout
) {
  const card = item.card;
  const tilePadding = 12;
  const tileWidth = layout.cellWidth;
  const tileHeight = layout.cellHeight;

  context.save();
  context.shadowColor = "rgba(31, 52, 88, 0.12)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 5;
  drawRoundedRect(context, x, y, tileWidth, tileHeight, 16);
  context.fillStyle = "#ffffff";
  context.fill();
  context.restore();

  const imageX =
    x + (tileWidth - layout.cardWidth) / 2;
  const imageY = y + tilePadding;

  context.save();
  drawRoundedRect(
    context,
    imageX,
    imageY,
    layout.cardWidth,
    layout.cardHeight,
    11
  );
  context.clip();

  if (image) {
    context.drawImage(
      image,
      imageX,
      imageY,
      layout.cardWidth,
      layout.cardHeight
    );
  } else {
    drawExportImageFallback(
      context,
      card,
      imageX,
      imageY,
      layout.cardWidth,
      layout.cardHeight
    );
  }

  context.restore();

  drawExportCountBadge(
    context,
    item.count,
    imageX + layout.cardWidth - 10,
    imageY + 10,
    layout.countFontSize
  );

  const textX = x + 12;
  const textWidth = tileWidth - 24;
  const nameY =
    imageY + layout.cardHeight + 26;

  context.fillStyle = "#1e293b";
  context.font =
    `800 ${layout.nameFontSize}px ` +
    '"Noto Sans JP", "Yu Gothic", sans-serif';
  context.textAlign = "left";

  drawClampedCanvasText(
    context,
    String(card.name || "名称不明"),
    textX,
    nameY,
    textWidth,
    layout.nameFontSize + 5,
    2
  );

  const infoY = tileHeight + y - 14;
  const cardNo = formatCardNo(card);
  const infoText = [
    cardNo,
    card.rarity || "不明"
  ].filter(Boolean).join("  ");

  context.fillStyle = "#687892";
  context.font =
    `600 ${layout.infoFontSize}px ` +
    '"Noto Sans JP", "Yu Gothic", sans-serif';
  context.fillText(infoText, textX, infoY);
}

function drawExportCountBadge(
  context,
  count,
  rightX,
  topY,
  fontSize
) {
  const label = `×${count}`;
  context.font =
    `800 ${fontSize}px ` +
    '"Noto Sans JP", "Yu Gothic", sans-serif';

  const textWidth = context.measureText(label).width;
  const width = Math.max(54, textWidth + 24);
  const height = fontSize + 18;
  const x = rightX - width;

  drawRoundedRect(
    context,
    x,
    topY,
    width,
    height,
    height / 2
  );

  context.fillStyle = "rgba(21, 34, 58, 0.92)";
  context.fill();
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    label,
    x + width / 2,
    topY + height / 2 + 1
  );
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
}

function drawExportImageFallback(
  context,
  card,
  x,
  y,
  width,
  height
) {
  context.fillStyle = "#e7eef9";
  context.fillRect(x, y, width, height);
  context.fillStyle = "#37557e";
  context.font =
    '800 18px "Noto Sans JP", "Yu Gothic", sans-serif';
  context.textAlign = "center";

  drawClampedCanvasText(
    context,
    String(card.name || "CARD IMAGE"),
    x + 14,
    y + height / 2,
    width - 28,
    24,
    3,
    "center"
  );

  context.textAlign = "left";
}

function drawClampedCanvasText(
  context,
  text,
  x,
  y,
  maxWidth,
  lineHeight,
  maxLines,
  textAlign = "left"
) {
  const characters = Array.from(text);
  const lines = [];
  let currentLine = "";

  for (const character of characters) {
    const nextLine = currentLine + character;

    if (
      currentLine &&
      context.measureText(nextLine).width > maxWidth
    ) {
      lines.push(currentLine);
      currentLine = character;

      if (lines.length === maxLines) {
        break;
      }
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  const consumedLength = lines.join("").length;

  if (
    consumedLength < characters.length &&
    lines.length > 0
  ) {
    let lastLine = lines[lines.length - 1];

    while (
      lastLine &&
      context.measureText(lastLine + "…").width > maxWidth
    ) {
      lastLine = lastLine.slice(0, -1);
    }

    lines[lines.length - 1] = lastLine + "…";
  }

  const originalAlign = context.textAlign;
  context.textAlign = textAlign;

  const drawX =
    textAlign === "center"
      ? x + maxWidth / 2
      : x;

  lines.forEach((line, index) => {
    context.fillText(
      line,
      drawX,
      y + index * lineHeight
    );
  });

  context.textAlign = originalAlign;
}

function drawRoundedRect(
  context,
  x,
  y,
  width,
  height,
  radius
) {
  const r = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + r
  );
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - r,
    y + height
  );
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - r
  );
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function loadExportCardImage(imageUrl) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = imageUrl;
  });
}

function canvasToBlob(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(
      blob => resolve(blob),
      "image/png"
    );
  });
}

function sanitizeExportFileName(value) {
  return String(value || "export")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");
}

if (exportHighRareImageButton) {
  exportHighRareImageButton.addEventListener(
    "click",
    () => {
      exportOpenedCardsImage({
        onlyHighRare: true,
        button: exportHighRareImageButton
      });
    }
  );
}

if (exportAllCardsImageButton) {
  exportAllCardsImageButton.addEventListener(
    "click",
    () => {
      exportOpenedCardsImage({
        onlyHighRare: false,
        button: exportAllCardsImageButton
      });
    }
  );
}

updateSummaryExportButtons();

summaryDiv.addEventListener("click", handleCardTileClick);
resultDiv.addEventListener("click", handleCardTileClick);

summaryDiv.addEventListener("keydown", handleCardTileKeydown);
resultDiv.addEventListener("keydown", handleCardTileKeydown);

cardModalClose.addEventListener("click", closeCardModal);

cardModal.addEventListener("click", event => {
  if (
    event.target.classList.contains("card-modal") ||
    event.target.classList.contains("card-modal__backdrop")
  ) {
    closeCardModal();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !cardModal.classList.contains("hidden")) {
    closeCardModal();
  }
});