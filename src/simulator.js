export const RARITY_DISPLAY_ORDER = [
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
  "SAR↑",
  "不明"
];

// app.js 側が RARITY_ORDER を参照していても壊れないように互換用で残す
export const RARITY_ORDER = RARITY_DISPLAY_ORDER;

export const RARITY_GROUP_ORDER = ["C", "U", "R", "RR", "AR", "SR↑", "不明"];

const HIGH_RARITY_VALUES = [
  "SR",
  "SAR",
  "UR",
  "HR",
  "SSR",
  "MUR",
  "BWR",
  "MA",
  "MM",
  "ACE",
  "SAR↑"
];

export function normalizeCards(cards) {
  return cards.map(card => {
    const rarity = card.rarity || "不明";
    const rarityGroup = getRarityGroup(rarity);

    return {
      ...card,
      rarity,
      rarityGroup,
      cardNoNumber: toCardNoNumber(card.cardNo),
      displayName: `${card.cardNo} ${card.name} ${rarity}`
    };
  });
}

export function getRarityGroup(rarity) {
  if (["C", "U", "R", "RR", "AR"].includes(rarity)) {
    return rarity;
  }

  if (HIGH_RARITY_VALUES.includes(rarity)) {
    return "SR↑";
  }

  return "不明";
}

export function buildCardPools(cards) {
  const pools = {};

  cards.forEach(card => {
    addCardToPool(pools, card.rarityGroup, card);

    // CやUなど、rarityGroup === rarity の場合に二重登録しない
    if (card.rarity !== card.rarityGroup) {
      addCardToPool(pools, card.rarity, card);
    }
  });

  Object.keys(pools).forEach(key => {
    pools[key] = sortCards(pools[key]);
  });

  return pools;
}

function addCardToPool(pools, key, card) {
  if (!key) {
    return;
  }

  if (!pools[key]) {
    pools[key] = [];
  }

  pools[key].push(card);
}

export function openPacks(cards, packCount, packRule) {
  if (packRule.boxRules?.enabled) {
    const resultPacks = [];
    let nextPackNo = 1;

    while (resultPacks.length < packCount) {
      const box = openBox(cards, packRule);

      for (const pack of box.packs) {
        resultPacks.push({
          ...pack,
          packNo: nextPackNo
        });

        nextPackNo++;

        if (resultPacks.length >= packCount) {
          break;
        }
      }
    }

    return resultPacks;
  }

  return openLoosePacks(cards, packCount, packRule);
}

export function openBox(cards, packRule) {
  const pools = buildCardPools(cards);
  const packsPerBox = packRule.packsPerBox || 30;

  const variableSlotCards = createBoxVariableSlotCards(
    pools,
    packRule,
    packsPerBox
  );

  shuffleArray(variableSlotCards);

  const packs = [];

  for (let i = 1; i <= packsPerBox; i++) {
    const packCards = [];
    const excludedCardIdsInPack = new Set();

    for (const slot of packRule.baseSlots || []) {
      const count = slot.count || 1;

      for (let j = 0; j < count; j++) {
        const card = pickFromPool(pools, slot.rarityGroup, excludedCardIdsInPack);

        if (card) {
          packCards.push(card);
          excludedCardIdsInPack.add(getCardKey(card));
        }
      }
    }

    const variableCard = variableSlotCards[i - 1];

    if (variableCard) {
      packCards.push(variableCard);
    }

    packs.push({
      packNo: i,
      cards: sortCards(packCards.filter(Boolean))
    });
  }

  return {
    packs,
    boxSummary: createBoxSummary(packs)
  };
}

function openLoosePacks(cards, packCount, packRule) {
  const pools = buildCardPools(cards);
  const packs = [];

  for (let i = 1; i <= packCount; i++) {
    const packCards = [];
    const excludedCardIdsInPack = new Set();

    for (const slot of packRule.baseSlots || []) {
      const count = slot.count || 1;

      for (let j = 0; j < count; j++) {
        const card = pickFromPool(pools, slot.rarityGroup, excludedCardIdsInPack);

        if (card) {
          packCards.push(card);
          excludedCardIdsInPack.add(getCardKey(card));
        }
      }
    }

    const rareCard = pickFromPool(pools, "R", excludedCardIdsInPack);

    if (rareCard) {
      packCards.push(rareCard);
    }

    packs.push({
      packNo: i,
      cards: sortCards(packCards.filter(Boolean))
    });
  }

  return packs;
}

function createBoxVariableSlotCards(pools, packRule, packsPerBox) {
  const boxRules = packRule.boxRules || {};
  const cards = [];
  const excludedCardIdsInBox = new Set();

  /*
    重要：
    fixedBoxInclusions は「MEGAシリーズのグッズSR確定枠」などを想定。
    これは通常高レア枠とは別枠なので、boxHitTargetCountを消費しない。
  */
  for (const fixedRule of boxRules.fixedBoxInclusions || []) {
    if (fixedRule.enabled === false) {
      continue;
    }

    const fixedCards = pickFixedInclusionCards(
      pools,
      fixedRule,
      excludedCardIdsInBox
    );

    fixedCards.forEach(card => {
      cards.push(card);
      excludedCardIdsInBox.add(getCardKey(card));
    });
  }

  /*
    通常高レア枠。
    SR / SAR / UR / MUR などから抽選する枠。
    fixedBoxInclusionsとは独立して必ず抽選する。
  */
  const boxHitTargetCount =
    boxRules.boxHit?.enabled === false
      ? 0
      : pickCount(boxRules.boxHit?.countDistribution, 1);

  for (let i = 0; i < boxHitTargetCount; i++) {
    const hitCard = pickBoxHitCard(
      pools,
      boxRules.boxHit?.weightedRarities || [],
      excludedCardIdsInBox
    );

    if (hitCard) {
      cards.push(hitCard);
      excludedCardIdsInBox.add(getCardKey(hitCard));
    }
  }

  /*
    2枚箱など、通常高レア枠が増えた場合のR枚数調整。
    例：
    boxHitTargetCount = 1 → extraHitCount = 0
    boxHitTargetCount = 2 → extraHitCount = 1 → Rを1枚減らす
  */
  const extraHitCount = Math.max(0, boxHitTargetCount - 1);
  const rCountAdjustment =
    extraHitCount * (boxRules.boxHit?.extraHitRCountAdjustment || 0);

  for (const countRule of boxRules.boxRarityCounts || []) {
    let count = getRarityCount(countRule);

    if (countRule.rarity === "R") {
      count = Math.max(0, count + rCountAdjustment);
    }

    const avoidDuplicateInBox = shouldAvoidDuplicateInBox(
      countRule.rarity,
      boxRules,
      countRule
    );

    for (let i = 0; i < count; i++) {
      const excludedSet = avoidDuplicateInBox ? excludedCardIdsInBox : new Set();
      const card = pickFromPool(pools, countRule.rarity, excludedSet);

      if (card) {
        cards.push(card);

        if (avoidDuplicateInBox) {
          excludedCardIdsInBox.add(getCardKey(card));
        }
      }
    }
  }

  while (cards.length < packsPerBox) {
    const fillCard =
      pickFromPool(pools, boxRules.fillRarityGroup || "U", new Set()) ||
      pickFromPool(pools, "C", new Set());

    if (!fillCard) {
      break;
    }

    cards.push(fillCard);
  }

  return cards.slice(0, packsPerBox);
}

function pickFixedInclusionCards(pools, fixedRule, excludedCardIdsInBox) {
  const count = fixedRule.count || 1;
  const candidates = getCandidatesByFixedRule(pools, fixedRule)
    .filter(card => !excludedCardIdsInBox.has(getCardKey(card)));

  const picked = [];

  if (candidates.length === 0) {
    console.warn("fixed inclusion skipped: no candidates", fixedRule);
    return picked;
  }

  const localExcluded = new Set();

  for (let i = 0; i < count; i++) {
    const availableCandidates = candidates.filter(card => {
      return !localExcluded.has(getCardKey(card));
    });

    const targetCandidates =
      availableCandidates.length > 0 ? availableCandidates : candidates;

    const card = pickRandom(targetCandidates);

    if (card) {
      picked.push(card);
      localExcluded.add(getCardKey(card));
    }
  }

  return picked;
}

function getCandidatesByFixedRule(pools, fixedRule) {
  const basePool = pools[fixedRule.rarity] || [];

  return basePool.filter(card => {
    if (fixedRule.category && card.category !== fixedRule.category) {
      return false;
    }

    if (fixedRule.trainerType && card.trainerType !== fixedRule.trainerType) {
      return false;
    }

    if (fixedRule.pokemonType && card.pokemonType !== fixedRule.pokemonType) {
      return false;
    }

    if (fixedRule.nameIncludes && !card.name.includes(fixedRule.nameIncludes)) {
      return false;
    }

    return true;
  });
}

function pickBoxHitCard(pools, weightedRarities, excludedCardIdsInBox) {
  const availableItems = weightedRarities.filter(item => {
    const pool = pools[item.rarity];

    if (!item.weight || item.weight <= 0 || !pool || pool.length === 0) {
      return false;
    }

    return pool.some(card => !excludedCardIdsInBox.has(getCardKey(card)));
  });

  if (availableItems.length === 0) {
    return pickFromPool(pools, "SR↑", excludedCardIdsInBox);
  }

  const totalWeight = availableItems.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * totalWeight;

  for (const item of availableItems) {
    rand -= item.weight;

    if (rand <= 0) {
      return pickFromPool(pools, item.rarity, excludedCardIdsInBox);
    }
  }

  return pickFromPool(
    pools,
    availableItems[availableItems.length - 1].rarity,
    excludedCardIdsInBox
  );
}

function getRarityCount(countRule) {
  if (typeof countRule.count === "number") {
    return countRule.count;
  }

  if (countRule.countDistribution) {
    return pickCount(countRule.countDistribution, 0);
  }

  return 0;
}

function pickCount(countDistribution, defaultCount) {
  if (!countDistribution || countDistribution.length === 0) {
    return defaultCount;
  }

  const totalWeight = countDistribution.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * totalWeight;

  for (const item of countDistribution) {
    rand -= item.weight;

    if (rand <= 0) {
      return item.count;
    }
  }

  return countDistribution[countDistribution.length - 1].count;
}

export function createCardSummary(packs) {
  const countMap = new Map();

  packs.flatMap(pack => pack.cards).forEach(card => {
    const key = getCardKey(card);

    if (!countMap.has(key)) {
      countMap.set(key, {
        card,
        count: 0
      });
    }

    countMap.get(key).count++;
  });

  return Array.from(countMap.values()).sort((a, b) => {
    return compareCards(a.card, b.card);
  });
}

export function groupSummaryByRarity(summary) {
  const grouped = {};

  summary.forEach(item => {
    const rarity = item.card.rarity;

    if (!grouped[rarity]) {
      grouped[rarity] = [];
    }

    grouped[rarity].push(item);
  });

  return grouped;
}

export function createBoxSummary(packs) {
  const summary = createCardSummary(packs);
  const rarityCounts = {};

  summary.forEach(item => {
    const rarity = item.card.rarity;

    if (!rarityCounts[rarity]) {
      rarityCounts[rarity] = 0;
    }

    rarityCounts[rarity] += item.count;
  });

  return rarityCounts;
}

export function sortCards(cards) {
  return [...cards].sort(compareCards);
}

function pickFromPool(pools, rarityOrGroup, excludedCardIds) {
  const pool = pools[rarityOrGroup];

  if (!pool || pool.length === 0) {
    return null;
  }

  let candidates = pool.filter(card => !excludedCardIds.has(getCardKey(card)));

  if (candidates.length === 0) {
    candidates = pool;
  }

  return pickRandom(candidates);
}

function pickRandom(cards) {
  if (!cards || cards.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * cards.length);
  return cards[index];
}

function shouldAvoidDuplicateInBox(rarity, boxRules, countRule) {
  if (countRule.allowDuplicates === true) {
    return false;
  }

  if (countRule.avoidDuplicateInBox === true) {
    return true;
  }

  const targetGroups = boxRules.avoidDuplicateInBoxForRarityGroups || [];
  const rarityGroup = getRarityGroup(rarity);

  return targetGroups.includes(rarity) || targetGroups.includes(rarityGroup);
}

function compareCards(a, b) {
  const cardNoDiff = toCardNoNumber(a.cardNo) - toCardNoNumber(b.cardNo);

  if (cardNoDiff !== 0) {
    return cardNoDiff;
  }

  const rarityDiff = getRaritySortIndex(a.rarity) - getRaritySortIndex(b.rarity);

  if (rarityDiff !== 0) {
    return rarityDiff;
  }

  return String(a.name).localeCompare(String(b.name), "ja");
}

function getRaritySortIndex(rarity) {
  const index = RARITY_DISPLAY_ORDER.indexOf(rarity);
  return index === -1 ? 999 : index;
}

function toCardNoNumber(cardNo) {
  const value = Number(cardNo);

  if (Number.isNaN(value)) {
    return 9999;
  }

  return value;
}

function getCardKey(card) {
  return card.officialCardId || `${card.setCode}-${card.cardNo}-${card.name}-${card.rarity}`;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}