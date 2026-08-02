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

  ensureCommonUncommonCoverage(
    packs,
    cards,
    packRule
  );

  return packs;
}

/**
 * 1BOX内で、カードマスターに登録されているC・Uを
 * それぞれ最低1枚ずつ出現させる。
 *
 * 通常の開封結果を生成した後、BOX内で2枚以上出ているC/Uを、
 * まだ出ていないC/Uへ差し替える。
 *
 * トレーナーズは各パックのslotRulesと
 * maxTrainerCardsPerPackを守った枠にのみ配置する。
 */
function ensureCommonUncommonCoverage(packs, cards, packRule) {
  const enabled = getRuleValue(packRule, [
    ["boxRules", "guaranteeCommonUncommonCoverage"],
    ["guaranteeCommonUncommonCoverage"]
  ]);

  // 明示的にfalseの場合だけ無効化。未設定時は有効。
  if (enabled === false) {
    return;
  }

  const requiredCardMap = new Map();

  for (const card of cards) {
    if (!["C", "U"].includes(card.rarity)) {
      continue;
    }

    requiredCardMap.set(getCardId(card), card);
  }

  const boxCardCounts = countCardsInPacks(packs);

  // トレーナーズは置ける枠が限定されるため、先に補完する。
  const missingCards = [...requiredCardMap.values()]
    .filter(card => {
      return (boxCardCounts.get(getCardId(card)) || 0) === 0;
    })
    .sort((a, b) => {
      const trainerDiff = Number(isTrainer(b)) - Number(isTrainer(a));

      if (trainerDiff !== 0) {
        return trainerDiff;
      }

      return String(a.cardNo || "").localeCompare(
        String(b.cardNo || ""),
        "ja",
        { numeric: true }
      );
    });

  for (const missingCard of missingCards) {
    const replacement =
      findCoverageReplacement(
        packs,
        missingCard,
        boxCardCounts,
        packRule,
        true
      ) ||
      findCoverageReplacement(
        packs,
        missingCard,
        boxCardCounts,
        packRule,
        false
      );

    if (!replacement) {
      console.warn(
        "C/U最低1枚保証の差し替え先を確保できませんでした。",
        {
          cardNo: missingCard.cardNo,
          name: missingCard.name,
          rarity: missingCard.rarity
        }
      );
      continue;
    }

    const {
      packIndex,
      slotIndex,
      replacedCard
    } = replacement;

    packs[packIndex].cards[slotIndex] = missingCard;

    const replacedCardId = getCardId(replacedCard);
    const missingCardId = getCardId(missingCard);

    boxCardCounts.set(
      replacedCardId,
      (boxCardCounts.get(replacedCardId) || 0) - 1
    );

    boxCardCounts.set(
      missingCardId,
      (boxCardCounts.get(missingCardId) || 0) + 1
    );
  }
}

function countCardsInPacks(packs) {
  const counts = new Map();

  for (const pack of packs) {
    for (const card of pack.cards) {
      const cardId = getCardId(card);

      counts.set(
        cardId,
        (counts.get(cardId) || 0) + 1
      );
    }
  }

  return counts;
}

function findCoverageReplacement(
  packs,
  missingCard,
  boxCardCounts,
  packRule,
  requireSameRarity
) {
  const candidates = [];

  for (let packIndex = 0; packIndex < packs.length; packIndex += 1) {
    const pack = packs[packIndex];

    const alreadyExistsInPack = pack.cards.some(card => {
      return getCardId(card) === getCardId(missingCard);
    });

    if (alreadyExistsInPack) {
      continue;
    }

    for (let slotIndex = 0; slotIndex < pack.cards.length; slotIndex += 1) {
      const replacedCard = pack.cards[slotIndex];

      if (!["C", "U"].includes(replacedCard.rarity)) {
        continue;
      }

      const replacedCardId = getCardId(replacedCard);
      const replacedCardCount = boxCardCounts.get(replacedCardId) || 0;

      // 差し替え元もBOX内に最低1枚残す。
      if (replacedCardCount <= 1) {
        continue;
      }

      if (
        requireSameRarity &&
        replacedCard.rarity !== missingCard.rarity
      ) {
        continue;
      }

      if (
        !canPlaceCoverageCardInSlot(
          missingCard,
          replacedCard,
          pack,
          slotIndex,
          packRule
        )
      ) {
        continue;
      }

      candidates.push({
        packIndex,
        slotIndex,
        replacedCard,
        replacedCardCount
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // 多く重複しているカードを優先的に差し替える。
  candidates.sort((a, b) => {
    return b.replacedCardCount - a.replacedCardCount;
  });

  const highestCount = candidates[0].replacedCardCount;
  const bestCandidates = candidates.filter(candidate => {
    return candidate.replacedCardCount === highestCount;
  });

  return pickRandom(bestCandidates);
}

function canPlaceCoverageCardInSlot(
  cardToPlace,
  replacedCard,
  pack,
  slotIndex,
  packRule
) {
  if (!isTrainer(cardToPlace)) {
    return true;
  }

  const slotName = `slot${slotIndex + 1}`;
  const trainerRule = getTrainerSlotRule(packRule, slotName);

  if (!trainerRule.allowTrainer) {
    return false;
  }

  const currentTrainerCount = countTrainerCards(pack.cards);
  const trainerCountAfterReplacement =
    currentTrainerCount -
    (isTrainer(replacedCard) ? 1 : 0) +
    1;

  return (
    trainerCountAfterReplacement <=
    getMaxTrainerCardsPerPack(packRule)
  );
}

function createBoxPlan(pools, packRule) {
  const blockedBoxHitIds = new Set();

// Bonus SR slot:
// Exactly one SR per box from goods, Pokémon tools, or Energy.
// Support SR and Pokémon SR remain in the normal box-hit pool.
const guaranteedBonusSrCard = pickUniqueCard(
  pools.bonusSr,
  blockedBoxHitIds
);

if (guaranteedBonusSrCard) {
  blockedBoxHitIds.add(getCardId(guaranteedBonusSrCard));
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
    // SR・SAR・MURなどの高レアは、必ず後段の重み付き抽選で制御する。
    // fixedBoxInclusionsから高レアが混ざると、抽選回数が増えてしまうため除外。
    return !BOX_HIT_RARITY_VALUES.has(card.rarity);
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
    // グッズ・どうぐ・エネルギーSRは、
    // 共通の確定SR枠で1BOX1枚に制御する。
    // ポケモンSR・サポートSRは通常高レア抽選に残す。
    return !isBonusSr(card);
  });

  const boxHitCards = pickWeightedBoxHitCards(
    boxHitPool,
    boxHitCount,
    packRule,
    blockedBoxHitIds
  );

for (const card of boxHitCards) {
    blockedBoxHitIds.add(getCardId(card));
  }

  function pickWeightedBoxHitCards(
  pool,
  count,
  packRule,
  blockedIds = new Set()
) {
  const pickedCards = [];
  const localBlockedIds = new Set(blockedIds);

  const rarityWeights = getBoxHitRarityWeights(packRule);

  if (!rarityWeights || Object.keys(rarityWeights).length === 0) {
    throw new Error(
      "高レア抽選設定 boxHit.rarityWeights が見つかりません。data/rules/{setCode}.json を確認してください。"
    );
  }

  for (let i = 0; i < count; i += 1) {
    const availableCards = pool.filter(card => {
      return !localBlockedIds.has(getCardId(card));
    });

    if (availableCards.length === 0) {
      break;
    }

    const selectedRarity = pickWeightedRarity(
      availableCards,
      rarityWeights
    );

    if (!selectedRarity) {
      console.warn(
        "抽選可能な高レアリティがありません。",
        {
          rarityWeights,
          availableRarities: [
            ...new Set(availableCards.map(card => card.rarity))
          ]
        }
      );
      break;
    }

    const rarityPool = availableCards.filter(card => {
      return card.rarity === selectedRarity;
    });

    const selectedCard = pickUniqueCard(
      rarityPool,
      localBlockedIds
    );

    if (!selectedCard) {
      continue;
    }

    pickedCards.push(selectedCard);
    localBlockedIds.add(getCardId(selectedCard));
  }

  return pickedCards;
}

function pickWeightedRarity(cards, rarityWeights) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return null;
  }

  const availableRarities = new Set(
    cards.map(card => card.rarity)
  );

  const weightedItems = Object.entries(rarityWeights)
    .map(([rarity, weight]) => {
      return {
        rarity,
        weight: Number(weight)
      };
    })
    .filter(item => {
      return (
        availableRarities.has(item.rarity) &&
        Number.isFinite(item.weight) &&
        item.weight > 0
      );
    });

  if (weightedItems.length === 0) {
    return null;
  }

  const totalWeight = weightedItems.reduce((sum, item) => {
    return sum + item.weight;
  }, 0);

  let randomValue = Math.random() * totalWeight;

  for (const item of weightedItems) {
    randomValue -= item.weight;

    if (randomValue <= 0) {
      return item.rarity;
    }
  }

  return weightedItems[weightedItems.length - 1].rarity;
}

function getBoxHitRarityWeights(packRule) {
  return getRuleValue(packRule, [
    ["boxRules", "boxHit", "rarityWeights"],
    ["boxHit", "rarityWeights"],
    ["boxHitRarityWeights"]
  ]);
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
      ...(guaranteedBonusSrCard ? [guaranteedBonusSrCard] : []),
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

  const getReservedTrainerCount = () => {
    if (!slot4Card || !isTrainer(slot4Card)) {
      return 0;
    }

    return usedCardIds.has(getCardId(slot4Card)) ? 0 : 1;
  };

  const pickNormalSlotCard = (slotName, nonTrainerPool) => {
    const trainerRule = getTrainerSlotRule(packRule, slotName);
    const trainerCount = countTrainerCards(packCards);
    const maxTrainerCards = getMaxTrainerCardsPerPack(packRule);

    const canPickTrainer =
      trainerRule.allowTrainer &&
      trainerCount + getReservedTrainerCount() < maxTrainerCards &&
      Math.random() < trainerRule.trainerChance;

    if (canPickTrainer) {
      const trainerCard = pickUniqueCard(
        pools.lowTrainer,
        getBlockedIdsForRandomPick()
      );

      if (trainerCard) {
        return trainerCard;
      }
    }

    return pickUniqueCard(
      nonTrainerPool,
      getBlockedIdsForRandomPick()
    );
  };

  // Slots 1-3:
  // Whether a trainer can appear is controlled by each set's rule JSON.
  for (let slotNumber = 1; slotNumber <= 3; slotNumber += 1) {
    const card = pickNormalSlotCard(
      `slot${slotNumber}`,
      pools.slot123
    );

    addCard(card);
  }

  // Slot 4:
  // R / RR / AR / SR+ hit card if assigned.
  // Otherwise use the set-specific trainer rule for slot 4.
  if (slot4Card) {
    addCard(slot4Card);
  } else {
    const slot4NormalCard = pickNormalSlotCard(
      "slot4",
      pools.slot4NonTrainer
    );

    addCard(slot4NormalCard);
  }

  // Slot 5:
  // No R / RR / high rarity. Trainer appearance is rule-driven.
  const slot5Card = pickNormalSlotCard(
    "slot5",
    pools.slot5NonTrainer
  );

  addCard(slot5Card);

  // Safety fallback:
  // Keep five unique cards and never exceed the set-specific trainer limit.
  while (packCards.length < 5) {
    const nextSlotName = `slot${packCards.length + 1}`;
    const trainerRule = getTrainerSlotRule(packRule, nextSlotName);
    const trainerCount = countTrainerCards(packCards);
    const maxTrainerCards = getMaxTrainerCardsPerPack(packRule);

    const trainerAllowedForFallback =
      trainerRule.allowTrainer &&
      trainerCount + getReservedTrainerCount() < maxTrainerCards;

    const fallbackPool = trainerAllowedForFallback
      ? pools.anyNonHit
      : pools.anyNonTrainerNonHit;

    const fallback = pickUniqueCard(
      fallbackPool,
      getBlockedIdsForRandomPick()
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

    bonusSr: cards.filter(card => isBonusSr(card)),

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
  const inclusions = getRuleValue(packRule, [
    ["boxRules", "fixedBoxInclusions"],
    ["fixedBoxInclusions"]
  ]);

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

function getMaxTrainerCardsPerPack(packRule) {
  const value = getRuleValue(packRule, [
    ["packRules", "maxTrainerCardsPerPack"],
    ["trainerRules", "maxPerPack"],
    ["maxTrainerCardsPerPack"]
  ]);

  if (value === undefined || value === null) {
    return 1;
  }

  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return 1;
  }

  return Math.max(0, Math.floor(normalizedValue));
}

function getTrainerSlotRule(packRule, slotName) {
  const defaultTrainerChances = {
    slot1: 0,
    slot2: 0,
    slot3: 0,
    slot4: 0.28,
    slot5: 0.25
  };

  const defaultChance = defaultTrainerChances[slotName] ?? 0;

  const rule = getRuleValue(packRule, [
    ["packRules", "slotRules", slotName],
    ["trainerRules", "slots", slotName],
    ["slotRules", slotName],
    ["packRules", slotName]
  ]);

  if (typeof rule === "number") {
    const trainerChance = normalizeProbability(rule, defaultChance);

    return {
      allowTrainer: trainerChance > 0,
      trainerChance
    };
  }

  if (!rule || typeof rule !== "object") {
    return {
      allowTrainer: defaultChance > 0,
      trainerChance: defaultChance
    };
  }

  const allowTrainerValue =
    rule.allowTrainer ??
    rule.trainerEnabled ??
    rule.enabled;

  const trainerChance = normalizeProbability(
    rule.trainerChance ?? rule.chance,
    defaultChance
  );

  return {
    allowTrainer:
      allowTrainerValue === undefined
        ? trainerChance > 0
        : Boolean(allowTrainerValue),
    trainerChance
  };
}

function normalizeProbability(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  // Both 0.15 and 15 are accepted as 15%.
  const normalizedValue = numberValue > 1
    ? numberValue / 100
    : numberValue;

  return Math.min(1, Math.max(0, normalizedValue));
}

function countTrainerCards(cards) {
  return cards.reduce((count, card) => {
    return count + (isTrainer(card) ? 1 : 0);
  }, 0);
}

function getCardId(card) {
  return String(
    card.officialCardId ||
    `${card.setCode || ""}_${card.cardNo || ""}_${card.rarity || ""}_${card.name || ""}`
  );
}

function isTrainer(card) {
  return String(card.category || "").toLowerCase() === "trainer";
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

function isBonusSr(card) {
  if (card.rarity !== "SR") {
    return false;
  }

  const category = String(card.category || "").toLowerCase();
  const trainerType = String(card.trainerType || "");

  const isGoodsOrToolSr =
    category === "trainer" &&
    (
      trainerType === "グッズ" ||
      trainerType === "どうぐ" ||
      trainerType === "ポケモンのどうぐ"
    );

  const isEnergySr =
    category === "energy" ||
    trainerType === "エネルギー";

  return isGoodsOrToolSr || isEnergySr;
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