const RARITY_DISPLAY_ORDER = [
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

const HIGH_RARITY_VALUES = new Set([
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

// AR is controlled separately as a fixed-ish box count.
// Therefore AR is excluded from the normal box-hit pool.
const BOX_HIT_RARITY_VALUES = new Set([
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

export function normalizeCards(cards) {
  if (!Array.isArray(cards)) {
    return [];
  }

  return cards.map(card => {
    return {
      ...card,
      rarity: card.rarity || "不明"
    };
  });
}

export function openPacks(cards, packCount, packRule = {}) {
  const normalizedCards = normalizeCards(cards);
  const packsPerBox = getPacksPerBox(packRule);

  // 15 packs are treated as opening half of one generated box.
  if (packCount <= packsPerBox) {
    const boxPacks = openBox(normalizedCards, packRule);

    if (packCount === packsPerBox) {
      return boxPacks;
    }

    return shuffleArray(boxPacks)
      .slice(0, packCount)
      .map((pack, index) => {
        return {
          ...pack,
          packNo: index + 1,
          originalBoxPackNo: pack.packNo
        };
      });
  }

  const packs = [];

  while (packs.length < packCount) {
    packs.push(...openBox(normalizedCards, packRule));
  }

  return packs.slice(0, packCount).map((pack, index) => {
    return {
      ...pack,
      packNo: index + 1
    };
  });
}

export function openBox(cards, packRule = {}) {
  const pools = buildCardPools(cards);
  const packsPerBox = getPacksPerBox(packRule);
  const boxPlan = createBoxPlan(pools, packRule);

  // R / RR / AR / SR+ are all 4th-slot hit cards.
  // One hit card is assigned to at most one pack, so R/RR and high rarity
  // cannot appear in the same pack.
  const slot4Assignments = assignCardsToRandomPacks(
    boxPlan.slot4HitCards,
    packsPerBox
  );

  const packs = [];

  for (let index = 0; index < packsPerBox; index += 1) {
    const slot4Card = slot4Assignments.get(index) || null;

    packs.push({
      packNo: index + 1,
      cards: buildPackCards({
        pools,
        packRule,
        slot4Card
      })
    });
  }

  return packs;
}

function createBoxPlan(pools, packRule) {
  const blockedBoxHitIds = new Set();

  // Goods/tool SR: exactly one per box when such cards exist.
  // Support SR is NOT included here; it stays in the normal box-hit pool.
  const guaranteedGoodsSrCard = pickUniqueCard(
    pools.goodsSr,
    blockedBoxHitIds
  );

  if (guaranteedGoodsSrCard) {
    blockedBoxHitIds.add(getCardId(guaranteedGoodsSrCard));
  }

  // Keep compatibility with existing rules, but remove goods/tool SR from
  // fixed inclusions because they are controlled above.
  // This prevents a leftover fixedBoxInclusions rule from creating a second
  // goods/tool SR.
  const fixedCards = pickFixedBoxInclusionCards(
    pools,
    packRule,
    blockedBoxHitIds
  ).filter(card => {
    return !isGoodsSr(card);
  });

  for (const card of fixedCards) {
    blockedBoxHitIds.add(getCardId(card));
  }

  const arCount = pickCountFromDistribution(
    getRuleValue(packRule, [
      ["boxRules", "arCountDistribution"],
      ["boxRules", "ar", "countDistribution"],
      ["arCountDistribution"]
    ]),
    3
  );

  const rrCount = pickCountFromDistribution(
    getRuleValue(packRule, [
      ["boxRules", "rrCountDistribution"],
      ["boxRules", "rr", "countDistribution"],
      ["rrCountDistribution"]
    ]),
    {
      4: 70,
      5: 30
    }
  );

  const rCount = pickCountFromDistribution(
    getRuleValue(packRule, [
      ["boxRules", "rCountDistribution"],
      ["boxRules", "r", "countDistribution"],
      ["rCountDistribution"]
    ]),
    7
  );

  const boxHitCount = pickCountFromDistribution(
    getRuleValue(packRule, [
      ["boxRules", "boxHit", "countDistribution"],
      ["boxHit", "countDistribution"],
      ["boxHitCountDistribution"]
    ]),
    1
  );

  const arCards = pickManyUniqueCards(
    pools.ar,
    arCount,
    blockedBoxHitIds
  );

  for (const card of arCards) {
    blockedBoxHitIds.add(getCardId(card));
  }

  // Normal high-rarity hit.
  // Goods/tool SR is completely excluded here so only one goods/tool SR can
  // appear in a box. Support SR remains available.
  const boxHitPool = pools.boxHit.filter(card => {
    return !isGoodsSr(card);
  });

  const boxHitCards = pickManyUniqueCards(
    boxHitPool,
    boxHitCount,
    blockedBoxHitIds
  );

  for (const card of boxHitCards) {
    blockedBoxHitIds.add(getCardId(card));
  }

  // RR: basic target is 2 mega/primal ex + 2 normal ex.
  // If a 5th RR appears, it is chosen from the remaining RR cards.
  const rrCards = pickBoxRrCards(
    pools,
    rrCount,
    blockedBoxHitIds
  );

  for (const card of rrCards) {
    blockedBoxHitIds.add(getCardId(card));
  }

  // R cards are unique within a box.
  const rCards = pickManyUniqueCards(
    pools.r,
    rCount,
    blockedBoxHitIds
  );

  for (const card of rCards) {
    blockedBoxHitIds.add(getCardId(card));
  }

  return {
    slot4HitCards: [
      ...(guaranteedGoodsSrCard ? [guaranteedGoodsSrCard] : []),
      ...fixedCards,
      ...arCards,
      ...boxHitCards,
      ...rrCards,
      ...rCards
    ]
  };
}

function buildPackCards({ pools, packRule, slot4Card }) {
  const packCards = [];
  const usedCardIds = new Set();
  const reservedCardIds = new Set();

  if (slot4Card) {
    reservedCardIds.add(getCardId(slot4Card));
  }

  const addCard = card => {
    if (!card) {
      return false;
    }

    const cardId = getCardId(card);

    if (usedCardIds.has(cardId)) {
      return false;
    }

    packCards.push(card);
    usedCardIds.add(cardId);
    return true;
  };

  const getBlockedIdsForRandomPick = () => {
    return new Set([
      ...usedCardIds,
      ...reservedCardIds
    ]);
  };

  // Slots 1-3: basic non-trainer cards only.
  for (let i = 0; i < 3; i += 1) {
    const card = pickUniqueCard(
      pools.slot123,
      getBlockedIdsForRandomPick()
    );

    addCard(card);
  }

  // Slot 4: R / RR / AR / SR+ hit card if assigned.
  // Otherwise, a low-rarity trainer may appear here.
  if (slot4Card) {
    addCard(slot4Card);
  } else {
    const trainerUsed = packCards.some(card => isTrainer(card));
    const trainerChance = getSlotTrainerChance(packRule, "slot4", 0.28);

    let slot4NormalCard = null;

    if (!trainerUsed && Math.random() < trainerChance) {
      slot4NormalCard = pickUniqueCard(
        pools.lowTrainer,
        getBlockedIdsForRandomPick()
      );
    }

    if (!slot4NormalCard) {
      slot4NormalCard = pickUniqueCard(
        pools.slot4NonTrainer,
        getBlockedIdsForRandomPick()
      );
    }

    addCard(slot4NormalCard);
  }

  // Slot 5: no R / RR / high rarity.
  // Trainer appears 0-1 per pack, so no trainer if slot 4 already had one.
  const trainerUsed = packCards.some(card => isTrainer(card));
  const trainerChance = getSlotTrainerChance(packRule, "slot5", 0.25);

  let slot5Card = null;

  if (!trainerUsed && Math.random() < trainerChance) {
    slot5Card = pickUniqueCard(
      pools.lowTrainer,
      usedCardIds
    );
  }

  if (!slot5Card) {
    slot5Card = pickUniqueCard(
      pools.slot5NonTrainer,
      usedCardIds
    );
  }

  addCard(slot5Card);

  // Safety fallback: avoid duplicate cards, extra trainer if already used,
  // and additional R/RR/high-rarity cards.
  while (packCards.length < 5) {
    const trainerAlreadyUsed = packCards.some(card => isTrainer(card));
    const fallbackPool = trainerAlreadyUsed
      ? pools.anyNonTrainerNonHit
      : pools.anyNonHit;

    const fallback = pickUniqueCard(
      fallbackPool,
      usedCardIds
    );

    if (!fallback) {
      break;
    }

    addCard(fallback);
  }

  return packCards;
}

function buildCardPools(cards) {
  const nonHitCards = cards.filter(card => {
    return !isBoxHitCard(card);
  });

  const slot123 = nonHitCards.filter(card => {
    return !isTrainer(card) && ["C", "U"].includes(card.rarity);
  });

  const slot4NonTrainer = nonHitCards.filter(card => {
    return !isTrainer(card) && ["C", "U"].includes(card.rarity);
  });

  const slot5NonTrainer = nonHitCards.filter(card => {
    return !isTrainer(card) && ["C", "U"].includes(card.rarity);
  });

  const lowTrainer = nonHitCards.filter(card => {
    return isTrainer(card);
  });

  return {
    all: cards,

    slot123: slot123.length > 0
      ? slot123
      : nonHitCards.filter(card => !isTrainer(card)),

    slot4NonTrainer: slot4NonTrainer.length > 0
      ? slot4NonTrainer
      : nonHitCards.filter(card => !isTrainer(card)),

    slot5NonTrainer: slot5NonTrainer.length > 0
      ? slot5NonTrainer
      : nonHitCards.filter(card => !isTrainer(card)),

    lowTrainer,

    anyNonHit: nonHitCards,
    anyNonTrainerNonHit: nonHitCards.filter(card => !isTrainer(card)),

    r: cards.filter(card => card.rarity === "R"),
    rr: cards.filter(card => card.rarity === "RR"),

    rrMegaEx: cards.filter(card => {
      return card.rarity === "RR" && isMegaExRr(card);
    }),

    rrNormalEx: cards.filter(card => {
      return card.rarity === "RR" && isNormalExRr(card);
    }),

    ar: cards.filter(card => card.rarity === "AR"),

    goodsSr: cards.filter(card => isGoodsSr(card)),

    boxHit: cards.filter(card => {
      return BOX_HIT_RARITY_VALUES.has(card.rarity);
    })
  };
}

function pickBoxRrCards(pools, rrCount, blockedIds = new Set()) {
  const pickedCards = [];
  const localBlockedIds = new Set(blockedIds);

  // Basic target: 2 mega/primal ex RR.
  const megaExCards = pickManyUniqueCards(
    pools.rrMegaEx,
    Math.min(2, rrCount),
    localBlockedIds
  );

  for (const card of megaExCards) {
    pickedCards.push(card);
    localBlockedIds.add(getCardId(card));
  }

  // Basic target: 2 normal ex RR.
  const normalExTargetCount = Math.min(2, rrCount - pickedCards.length);

  const normalExCards = pickManyUniqueCards(
    pools.rrNormalEx,
    normalExTargetCount,
    localBlockedIds
  );

  for (const card of normalExCards) {
    pickedCards.push(card);
    localBlockedIds.add(getCardId(card));
  }

  // Fallback if the master has insufficient rrKind classification.
  while (pickedCards.length < Math.min(4, rrCount)) {
    const fallback = pickUniqueCard(
      pools.rr,
      localBlockedIds
    );

    if (!fallback) {
      break;
    }

    pickedCards.push(fallback);
    localBlockedIds.add(getCardId(fallback));
  }

  // 5th RR, if any, from remaining RR regardless of mega/normal.
  if (rrCount >= 5) {
    const extra = pickUniqueCard(
      pools.rr,
      localBlockedIds
    );

    if (extra) {
      pickedCards.push(extra);
      localBlockedIds.add(getCardId(extra));
    }
  }

  return pickedCards;
}

function pickFixedBoxInclusionCards(pools, packRule, blockedIds) {
  const inclusions = Array.isArray(packRule.fixedBoxInclusions)
    ? packRule.fixedBoxInclusions
    : [];

  const pickedCards = [];

  for (const inclusion of inclusions) {
    if (inclusion.enabled === false) {
      continue;
    }

    const count = Number(inclusion.count || 1);

    const pool = pools.all.filter(card => {
      return matchesInclusion(card, inclusion);
    });

    const cards = pickManyUniqueCards(
      pool,
      count,
      blockedIds
    );

    for (const card of cards) {
      pickedCards.push(card);
      blockedIds.add(getCardId(card));
    }
  }

  return pickedCards;
}

function matchesInclusion(card, inclusion) {
  if (inclusion.rarity && card.rarity !== inclusion.rarity) {
    return false;
  }

  if (inclusion.category && card.category !== inclusion.category) {
    return false;
  }

  if (inclusion.trainerType && card.trainerType !== inclusion.trainerType) {
    return false;
  }

  if (inclusion.pokemonType && card.pokemonType !== inclusion.pokemonType) {
    return false;
  }

  if (inclusion.name && card.name !== inclusion.name) {
    return false;
  }

  return true;
}

function assignCardsToRandomPacks(cards, packsPerBox) {
  const assignments = new Map();
  const indexes = shuffleArray(
    Array.from({ length: packsPerBox }, (_, index) => index)
  );

  cards.forEach((card, index) => {
    const packIndex = indexes[index];

    if (packIndex === undefined) {
      return;
    }

    assignments.set(packIndex, card);
  });

  return assignments;
}

function pickUniqueCard(pool, blockedIds = new Set()) {
  if (!Array.isArray(pool) || pool.length === 0) {
    return null;
  }

  const candidates = pool.filter(card => {
    return !blockedIds.has(getCardId(card));
  });

  if (candidates.length === 0) {
    return null;
  }

  return pickRandom(candidates);
}

function pickManyUniqueCards(pool, count, blockedIds = new Set()) {
  const pickedCards = [];
  const localBlockedIds = new Set(blockedIds);

  for (let i = 0; i < count; i += 1) {
    const card = pickUniqueCard(pool, localBlockedIds);

    if (!card) {
      break;
    }

    pickedCards.push(card);
    localBlockedIds.add(getCardId(card));
  }

  return pickedCards;
}

function pickRandom(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)];
}

function shuffleArray(items) {
  const copiedItems = [...items];

  for (let i = copiedItems.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copiedItems[i], copiedItems[j]] = [copiedItems[j], copiedItems[i]];
  }

  return copiedItems;
}

function pickCountFromDistribution(distribution, fallback) {
  if (distribution === null || distribution === undefined) {
    return pickCountFromDistribution(fallback, 0);
  }

  if (typeof distribution === "number") {
    return distribution;
  }

  if (Array.isArray(distribution)) {
    const items = distribution
      .map(item => {
        if (typeof item === "number") {
          return {
            count: item,
            weight: 1
          };
        }

        return {
          count: Number(item.count ?? item.value ?? 0),
          weight: Number(item.weight ?? item.rate ?? item.probability ?? 1)
        };
      })
      .filter(item => Number.isFinite(item.count) && item.weight > 0);

    return pickWeightedCount(items, 0);
  }

  if (typeof distribution === "object") {
    const items = Object.entries(distribution)
      .map(([count, weight]) => {
        return {
          count: Number(count),
          weight: Number(weight)
        };
      })
      .filter(item => Number.isFinite(item.count) && item.weight > 0);

    return pickWeightedCount(items, 0);
  }

  return 0;
}

function pickWeightedCount(items, fallback) {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }

  const totalWeight = items.reduce((sum, item) => {
    return sum + item.weight;
  }, 0);

  let randomValue = Math.random() * totalWeight;

  for (const item of items) {
    randomValue -= item.weight;

    if (randomValue <= 0) {
      return item.count;
    }
  }

  return items[items.length - 1].count;
}

function getRuleValue(object, paths) {
  for (const path of paths) {
    let current = object;

    for (const key of path) {
      if (current === null || current === undefined) {
        break;
      }

      current = current[key];
    }

    if (current !== null && current !== undefined) {
      return current;
    }
  }

  return undefined;
}

function getPacksPerBox(packRule) {
  return Number(
    getRuleValue(packRule, [
      ["packsPerBox"],
      ["boxRules", "packsPerBox"],
      ["box", "packsPerBox"]
    ]) || 30
  );
}

function getSlotTrainerChance(packRule, slotName, fallback) {
  const value = getRuleValue(packRule, [
    ["slotRules", slotName, "trainerChance"],
    ["packRules", slotName, "trainerChance"],
    ["trainerChance"]
  ]);

  if (value === undefined || value === null) {
    return fallback;
  }

  return Number(value);
}

function getCardId(card) {
  return String(
    card.officialCardId ||
    `${card.setCode || ""}_${card.cardNo || ""}_${card.rarity || ""}_${card.name || ""}`
  );
}

function isTrainer(card) {
  return card.category === "trainer";
}

function isHighRarity(card) {
  return HIGH_RARITY_VALUES.has(card.rarity);
}

function isBoxHitCard(card) {
  return (
    isHighRarity(card) ||
    card.rarity === "R" ||
    card.rarity === "RR"
  );
}

function isGoodsSr(card) {
  if (card.rarity !== "SR") {
    return false;
  }

  if (card.category !== "trainer") {
    return false;
  }

  const trainerType = String(card.trainerType || "");

  return (
    trainerType === "グッズ" ||
    trainerType === "どうぐ" ||
    trainerType === "ポケモンのどうぐ"
  );
}

function isMegaExRr(card) {
  if (card.rrKind === "megaEx") {
    return true;
  }

  const name = String(card.name || "");

  return (
    card.rarity === "RR" &&
    name.endsWith("ex") &&
    (
      name.startsWith("メガ") ||
      name.startsWith("ゲンシ")
    )
  );
}

function isNormalExRr(card) {
  if (card.rrKind === "normalEx") {
    return true;
  }

  if (card.rarity !== "RR") {
    return false;
  }

  const name = String(card.name || "");

  return name.endsWith("ex") && !isMegaExRr(card);
}

export function createCardSummary(packs) {
  const summaryMap = new Map();

  for (const pack of packs) {
    for (const card of pack.cards) {
      const cardId = getCardId(card);

      if (!summaryMap.has(cardId)) {
        summaryMap.set(cardId, {
          card,
          count: 0
        });
      }

      summaryMap.get(cardId).count += 1;
    }
  }

  return Array.from(summaryMap.values()).sort((a, b) => {
    return compareCards(a.card, b.card);
  });
}

export function createBoxSummary(packs) {
  const summary = {};

  for (const pack of packs) {
    for (const card of pack.cards) {
      const rarity = card.rarity || "不明";
      summary[rarity] = (summary[rarity] || 0) + 1;
    }
  }

  return summary;
}

export function sortCards(cards) {
  return [...cards].sort(compareCards);
}

function compareCards(a, b) {
  const aNo = Number(a.cardNo || 9999);
  const bNo = Number(b.cardNo || 9999);

  if (aNo !== bNo) {
    return aNo - bNo;
  }

  const aRarityIndex = getRarityIndex(a.rarity);
  const bRarityIndex = getRarityIndex(b.rarity);

  if (aRarityIndex !== bRarityIndex) {
    return aRarityIndex - bRarityIndex;
  }

  return String(a.name || "").localeCompare(String(b.name || ""), "ja");
}

function getRarityIndex(rarity) {
  const index = RARITY_DISPLAY_ORDER.indexOf(rarity || "不明");
  return index === -1 ? 999 : index;
}