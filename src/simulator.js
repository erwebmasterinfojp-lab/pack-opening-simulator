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
  const maxAttempts = getBoxGenerationMaxAttempts(packRule);
  let lastGeneratedPacks = [];
  let lastViolations = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const generatedBox = generateSingleBox(cards, packRule);
    const packs = generatedBox.packs;
    lastGeneratedPacks = packs;

    if (!generatedBox.trainerPlan.success) {
      lastViolations = generatedBox.trainerPlan.violations;
      continue;
    }

    const copyLimitResult = applyBoxCardCopyLimits(
      packs,
      cards,
      packRule
    );

    const trainerRuleResult = validateTrainerBoxPlan(
      packs,
      generatedBox.trainerPlan,
      packRule
    );

    if (copyLimitResult.success && trainerRuleResult.success) {
      return packs;
    }

    lastViolations = [
      ...copyLimitResult.violations,
      ...trainerRuleResult.violations
    ];
  }

  console.warn(
    "BOX生成ルールを完全には満たせませんでした。",
    {
      attempts: maxAttempts,
      violations: lastViolations
    }
  );

  return lastGeneratedPacks;
}

function generateSingleBox(cards, packRule) {
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

  const trainerPlan = createTrainerBoxPlan({
    pools,
    packRule,
    slot4Assignments,
    packsPerBox
  });

  const packs = [];

  for (let index = 0; index < packsPerBox; index += 1) {
    const slot4Card = slot4Assignments.get(index) || null;

    packs.push({
      packNo: index + 1,
      cards: buildPackCards({
        pools,
        packRule,
        slot4Card,
        packIndex: index,
        trainerPlan
      })
    });
  }

  return {
    packs,
    trainerPlan
  };
}

/**
 * boxRules.trainerBoxRules が有効なパックだけ、
 * 1BOX単位でC・Uトレーナーズの種類別枚数を先に決める。
 *
 * 設定がないパックは従来のtrainerChance方式をそのまま使うため、
 * アビスアイなど既存パックの挙動は変わらない。
 */
function createTrainerBoxPlan({
  pools,
  packRule,
  slot4Assignments,
  packsPerBox
}) {
  const rule = getTrainerBoxRule(packRule);

  if (!rule || rule.enabled !== true) {
    return {
      enabled: false,
      success: true,
      assignments: new Map(),
      targetCounts: {},
      pairedCardRules: [],
      violations: []
    };
  }

  const targetCounts = pickTrainerTargetCounts(
    rule.countRanges
  );

  if (Object.keys(targetCounts).length === 0) {
    return {
      enabled: true,
      success: false,
      assignments: new Map(),
      targetCounts: {},
      pairedCardRules: getPairedTrainerCardRules(rule),
      violations: [{
        reason: "trainerCountRangeMissing"
      }]
    };
  }

  /*
   * countRangesはC・Uの通常トレーナーズだけを対象とする。
   * SRなど、4枠目に割り当てられた高レアトレーナーズは
   * targetCountsから差し引かない。
   */
  const remainingCounts = {
    ...targetCounts
  };
  const violations = [];

  const trainerSlots = pickTrainerSlots({
    packRule,
    slot4Assignments,
    packsPerBox,
    count: sumObjectValues(remainingCounts)
  });

  if (!trainerSlots.success) {
    return {
      enabled: true,
      success: false,
      assignments: new Map(),
      targetCounts,
      pairedCardRules: getPairedTrainerCardRules(rule),
      violations: trainerSlots.violations
    };
  }

  const pairedCardRules = getPairedTrainerCardRules(rule);
  const cardSequences = {};

  for (const [trainerType, count] of Object.entries(remainingCounts)) {
    const trainerPool = pools.lowTrainer.filter(card => {
      return (
        isCountedTrainerCard(card, rule) &&
        String(card.trainerType || "") === trainerType
      );
    });

    const pairRule = pairedCardRules.find(item => {
      return item.trainerType === trainerType;
    });

    const sequenceResult = pairRule
      ? buildPairedTrainerCardSequence(
          trainerPool,
          count,
          pairRule,
          packRule
        )
      : buildBalancedTrainerCardSequence(
          trainerPool,
          count,
          packRule
        );

    if (!sequenceResult.success) {
      violations.push(...sequenceResult.violations.map(item => {
        return {
          ...item,
          trainerType
        };
      }));
      continue;
    }

    cardSequences[trainerType] = sequenceResult.cards;
  }

  if (violations.length > 0) {
    return {
      enabled: true,
      success: false,
      assignments: new Map(),
      targetCounts,
      pairedCardRules,
      violations
    };
  }

  const trainerTypes = shuffleArray(
    Object.entries(remainingCounts).flatMap(([trainerType, count]) => {
      return Array.from({ length: count }, () => trainerType);
    })
  );

  const assignments = new Map();
  const usedCardIdsByPack = new Map();

  for (let index = 0; index < trainerSlots.slots.length; index += 1) {
    const slot = trainerSlots.slots[index];
    const trainerType = trainerTypes[index];
    const sequence = cardSequences[trainerType];

    if (!sequence || sequence.length === 0) {
      violations.push({
        reason: "trainerCardSequenceEmpty",
        trainerType
      });
      continue;
    }

    const usedIds = usedCardIdsByPack.get(slot.packIndex) || new Set();
    let cardIndex = sequence.findIndex(card => {
      return !usedIds.has(getCardId(card));
    });

    if (cardIndex < 0) {
      violations.push({
        reason: "duplicateTrainerCardInPack",
        trainerType,
        packIndex: slot.packIndex
      });
      continue;
    }

    const [card] = sequence.splice(cardIndex, 1);
    assignments.set(getTrainerAssignmentKey(
      slot.packIndex,
      slot.slotName
    ), card);

    usedIds.add(getCardId(card));
    usedCardIdsByPack.set(slot.packIndex, usedIds);
  }

  return {
    enabled: true,
    success: violations.length === 0,
    assignments,
    targetCounts,
    pairedCardRules,
    violations
  };
}

function getTrainerBoxRule(packRule) {
  const rule = getRuleValue(packRule, [
    ["boxRules", "trainerBoxRules"],
    ["trainerBoxRules"]
  ]);

  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    return null;
  }

  return rule;
}

function isTrainerBoxRuleEnabled(packRule) {
  const rule = getTrainerBoxRule(packRule);
  return Boolean(rule && rule.enabled === true);
}

function pickTrainerTargetCounts(countRanges) {
  const targetCounts = {};

  if (
    !countRanges ||
    typeof countRanges !== "object" ||
    Array.isArray(countRanges)
  ) {
    return targetCounts;
  }

  for (
    const [trainerType, rawRange] of
    Object.entries(countRanges)
  ) {
    if (
      !rawRange ||
      typeof rawRange !== "object" ||
      Array.isArray(rawRange)
    ) {
      continue;
    }

    const min = normalizeNonNegativeInteger(
      rawRange.min,
      0
    );
    const max = Math.max(
      min,
      normalizeNonNegativeInteger(
        rawRange.max,
        min
      )
    );

    targetCounts[trainerType] = pickRandomInteger(
      min,
      max
    );
  }

  return targetCounts;
}

function pickRandomInteger(min, max) {
  return (
    min +
    Math.floor(Math.random() * (max - min + 1))
  );
}

function getCountedTrainerRarities(rule) {
  const rarities = Array.isArray(rule?.countedRarities)
    ? rule.countedRarities
    : ["C", "U"];

  return new Set(
    rarities.map(value => String(value))
  );
}

function isCountedTrainerCard(card, rule) {
  return (
    isTrainer(card) &&
    getCountedTrainerRarities(rule).has(
      String(card.rarity || "")
    )
  );
}

function pickTrainerSlots({
  packRule,
  slot4Assignments,
  packsPerBox,
  count
}) {
  const maxTrainerCardsPerPack = getMaxTrainerCardsPerPack(packRule);
  const trainerCountByPack = new Map();
  const candidates = [];

  for (let packIndex = 0; packIndex < packsPerBox; packIndex += 1) {
    const slot4Card = slot4Assignments.get(packIndex) || null;
    const fixedTrainerCount = isTrainer(slot4Card) ? 1 : 0;
    trainerCountByPack.set(packIndex, fixedTrainerCount);

    for (let slotNumber = 1; slotNumber <= 5; slotNumber += 1) {
      const slotName = `slot${slotNumber}`;
      const trainerRule = getTrainerSlotRule(packRule, slotName);

      if (!trainerRule.allowTrainer) {
        continue;
      }

      if (slotName === "slot4" && slot4Card) {
        continue;
      }

      candidates.push({
        packIndex,
        slotName,
        slotNumber,
        weight: Math.max(0.0001, trainerRule.trainerChance)
      });
    }
  }

  const selectedSlots = [];
  const remainingCandidates = [...candidates];

  while (selectedSlots.length < count) {
    const availableCandidates = remainingCandidates.filter(candidate => {
      return (
        (trainerCountByPack.get(candidate.packIndex) || 0) <
        maxTrainerCardsPerPack
      );
    });

    if (availableCandidates.length === 0) {
      return {
        success: false,
        slots: selectedSlots,
        violations: [{
          reason: "trainerSlotCapacityShortage",
          requestedCount: count,
          assignedCount: selectedSlots.length,
          maxTrainerCardsPerPack
        }]
      };
    }

    const selected = pickWeightedItem(
      availableCandidates,
      candidate => candidate.weight
    );

    selectedSlots.push(selected);
    trainerCountByPack.set(
      selected.packIndex,
      (trainerCountByPack.get(selected.packIndex) || 0) + 1
    );

    const removeIndex = remainingCandidates.findIndex(candidate => {
      return (
        candidate.packIndex === selected.packIndex &&
        candidate.slotName === selected.slotName
      );
    });

    if (removeIndex >= 0) {
      remainingCandidates.splice(removeIndex, 1);
    }
  }

  selectedSlots.sort((a, b) => {
    if (a.packIndex !== b.packIndex) {
      return a.packIndex - b.packIndex;
    }

    return a.slotNumber - b.slotNumber;
  });

  return {
    success: true,
    slots: selectedSlots,
    violations: []
  };
}

function buildBalancedTrainerCardSequence(
  pool,
  count,
  packRule
) {
  if (count === 0) {
    return {
      success: true,
      cards: [],
      violations: []
    };
  }

  if (!Array.isArray(pool) || pool.length === 0) {
    return {
      success: false,
      cards: [],
      violations: [{
        reason: "trainerCardPoolEmpty",
        requestedCount: count
      }]
    };
  }

  const counts = new Map();
  const cards = [];
  let minimumRequired = 0;
  let maximumCapacity = 0;

  for (const card of pool) {
    const limit = getCardCopyLimit(card, packRule);
    minimumRequired += limit.minPerCard;
    maximumCapacity += limit.maxPerCard;
    counts.set(getCardId(card), 0);
  }

  if (count < minimumRequired || count > maximumCapacity) {
    return {
      success: false,
      cards: [],
      violations: [{
        reason: "trainerCardCopyLimitCapacity",
        requestedCount: count,
        minimumRequired,
        maximumCapacity
      }]
    };
  }

  for (const card of shuffleArray(pool)) {
    const limit = getCardCopyLimit(card, packRule);

    for (let i = 0; i < limit.minPerCard; i += 1) {
      cards.push(card);
      counts.set(
        getCardId(card),
        (counts.get(getCardId(card)) || 0) + 1
      );
    }
  }

  while (cards.length < count) {
    const candidates = pool.filter(card => {
      const limit = getCardCopyLimit(card, packRule);
      return (counts.get(getCardId(card)) || 0) < limit.maxPerCard;
    });

    if (candidates.length === 0) {
      return {
        success: false,
        cards,
        violations: [{
          reason: "trainerCardSequenceCapacityShortage",
          requestedCount: count,
          assignedCount: cards.length
        }]
      };
    }

    candidates.sort((a, b) => {
      return (
        (counts.get(getCardId(a)) || 0) -
        (counts.get(getCardId(b)) || 0)
      );
    });

    const lowestCount = counts.get(getCardId(candidates[0])) || 0;
    const balancedCandidates = candidates.filter(card => {
      return (counts.get(getCardId(card)) || 0) === lowestCount;
    });
    const selected = pickRandom(balancedCandidates);

    cards.push(selected);
    counts.set(
      getCardId(selected),
      (counts.get(getCardId(selected)) || 0) + 1
    );
  }

  return {
    success: true,
    cards: shuffleArray(cards),
    violations: []
  };
}

function buildPairedTrainerCardSequence(
  pool,
  count,
  pairRule,
  packRule
) {
  if (count === 0) {
    return {
      success: true,
      cards: [],
      violations: []
    };
  }

  const pairGroups = buildPairedCardGroups(pool, pairRule);
  const pairedCardIds = new Set(
    pairGroups.flatMap(group => {
      return group.cards.map(card => getCardId(card));
    })
  );
  const unpairedCards = pool.filter(card => {
    return !pairedCardIds.has(getCardId(card));
  });

  if (pairGroups.length === 0) {
    return buildBalancedTrainerCardSequence(
      pool,
      count,
      packRule
    );
  }

  const groupLimits = pairGroups.map(group => {
    const limits = group.cards.map(card => {
      return getCardCopyLimit(card, packRule);
    });

    return {
      group,
      minBlocks: Math.max(...limits.map(limit => limit.minPerCard)),
      maxBlocks: Math.min(...limits.map(limit => limit.maxPerCard))
    };
  });

  const minPairBlocks = groupLimits.reduce((sum, item) => {
    return sum + item.minBlocks;
  }, 0);
  const maxPairBlocks = groupLimits.reduce((sum, item) => {
    return sum + item.maxBlocks;
  }, 0);

  const unpairedMin = unpairedCards.reduce((sum, card) => {
    return sum + getCardCopyLimit(card, packRule).minPerCard;
  }, 0);
  const unpairedMax = unpairedCards.reduce((sum, card) => {
    return sum + getCardCopyLimit(card, packRule).maxPerCard;
  }, 0);

  const feasibleUnpairedCounts = [];

  for (
    let unpairedCount = unpairedMin;
    unpairedCount <= unpairedMax;
    unpairedCount += 1
  ) {
    const pairedCardCount = count - unpairedCount;

    if (pairedCardCount < 0 || pairedCardCount % 2 !== 0) {
      continue;
    }

    const pairBlockCount = pairedCardCount / 2;

    if (
      pairBlockCount >= minPairBlocks &&
      pairBlockCount <= maxPairBlocks
    ) {
      feasibleUnpairedCounts.push(unpairedCount);
    }
  }

  if (feasibleUnpairedCounts.length === 0) {
    return {
      success: false,
      cards: [],
      violations: [{
        reason: "pairedTrainerSequenceCapacity",
        requestedCount: count,
        unpairedMin,
        unpairedMax,
        minPairBlocks,
        maxPairBlocks
      }]
    };
  }

  const selectedUnpairedCount = pickRandom(feasibleUnpairedCounts);
  const targetPairBlockCount =
    (count - selectedUnpairedCount) / 2;
  const pairBlockCounts = new Map();
  const pairBlocks = [];

  for (const item of groupLimits) {
    pairBlockCounts.set(item.group.baseName, item.minBlocks);

    for (let i = 0; i < item.minBlocks; i += 1) {
      pairBlocks.push(createPairBlock(item.group.cards));
    }
  }

  while (pairBlocks.length < targetPairBlockCount) {
    const candidates = groupLimits.filter(item => {
      return (
        (pairBlockCounts.get(item.group.baseName) || 0) <
        item.maxBlocks
      );
    });

    if (candidates.length === 0) {
      return {
        success: false,
        cards: [],
        violations: [{
          reason: "pairedTrainerBlockShortage",
          requestedBlocks: targetPairBlockCount,
          assignedBlocks: pairBlocks.length
        }]
      };
    }

    candidates.sort((a, b) => {
      return (
        (pairBlockCounts.get(a.group.baseName) || 0) -
        (pairBlockCounts.get(b.group.baseName) || 0)
      );
    });

    const lowestCount =
      pairBlockCounts.get(candidates[0].group.baseName) || 0;
    const balancedCandidates = candidates.filter(item => {
      return (
        (pairBlockCounts.get(item.group.baseName) || 0) ===
        lowestCount
      );
    });
    const selected = pickRandom(balancedCandidates);

    pairBlocks.push(createPairBlock(selected.group.cards));
    pairBlockCounts.set(
      selected.group.baseName,
      (pairBlockCounts.get(selected.group.baseName) || 0) + 1
    );
  }

  const unpairedResult = buildBalancedTrainerCardSequence(
    unpairedCards,
    selectedUnpairedCount,
    packRule
  );

  if (!unpairedResult.success) {
    return unpairedResult;
  }

  const blocks = [
    ...pairBlocks,
    ...unpairedResult.cards.map(card => [card])
  ];

  return {
    success: true,
    cards: shuffleArray(blocks).flat(),
    violations: []
  };
}

function buildPairedCardGroups(pool, pairRule) {
  const suffixes = Array.isArray(pairRule.nameSuffixes)
    ? pairRule.nameSuffixes.map(value => String(value))
    : ["-L", "-R"];
  const groups = new Map();

  for (const card of pool) {
    const pairInfo = getPairedCardInfo(card, suffixes);

    if (!pairInfo) {
      continue;
    }

    if (!groups.has(pairInfo.baseName)) {
      groups.set(pairInfo.baseName, new Map());
    }

    groups.get(pairInfo.baseName).set(pairInfo.suffix, card);
  }

  return [...groups.entries()]
    .filter(([, cardsBySuffix]) => {
      return suffixes.every(suffix => cardsBySuffix.has(suffix));
    })
    .map(([baseName, cardsBySuffix]) => {
      return {
        baseName,
        cards: suffixes.map(suffix => cardsBySuffix.get(suffix))
      };
    });
}

function createPairBlock(cards) {
  return Math.random() < 0.5
    ? [...cards]
    : [...cards].reverse();
}

function getPairedCardInfo(card, suffixes) {
  const name = String(card.name || "");
  const suffix = suffixes.find(value => name.endsWith(value));

  if (!suffix) {
    return null;
  }

  return {
    baseName: name.slice(0, -suffix.length),
    suffix
  };
}

function getPairedTrainerCardRules(rule) {
  const rules = rule && Array.isArray(rule.pairedCardRules)
    ? rule.pairedCardRules
    : [];

  return rules
    .filter(item => {
      return (
        item &&
        item.enabled !== false &&
        typeof item.trainerType === "string"
      );
    })
    .map(item => {
      return {
        ...item,
        nameSuffixes: Array.isArray(item.nameSuffixes)
          ? item.nameSuffixes.map(value => String(value))
          : ["-L", "-R"]
      };
    });
}

function getCardCopyLimit(card, packRule) {
  const rarityLimits = getBoxCardCopyLimits(packRule);
  const limit = rarityLimits[card.rarity];

  if (!limit) {
    return {
      minPerCard: 0,
      maxPerCard: Number.POSITIVE_INFINITY
    };
  }

  return limit;
}

function getTrainerAssignmentKey(packIndex, slotName) {
  return `${packIndex}:${slotName}`;
}

function sumObjectValues(object) {
  return Object.values(object).reduce((sum, value) => {
    return sum + Number(value || 0);
  }, 0);
}

function pickWeightedItem(items, getWeight) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const weightedItems = items
    .map(item => {
      return {
        item,
        weight: Number(getWeight(item))
      };
    })
    .filter(entry => {
      return Number.isFinite(entry.weight) && entry.weight > 0;
    });

  if (weightedItems.length === 0) {
    return pickRandom(items);
  }

  const totalWeight = weightedItems.reduce((sum, entry) => {
    return sum + entry.weight;
  }, 0);
  let randomValue = Math.random() * totalWeight;

  for (const entry of weightedItems) {
    randomValue -= entry.weight;

    if (randomValue <= 0) {
      return entry.item;
    }
  }

  return weightedItems[weightedItems.length - 1].item;
}

function validateTrainerBoxPlan(packs, trainerPlan, packRule) {
  if (!trainerPlan.enabled) {
    return {
      success: true,
      violations: []
    };
  }

  const violations = [];
  const actualCounts = {};
  const rule = getTrainerBoxRule(packRule);

  for (const pack of packs) {
    const trainerCount = countTrainerCards(pack.cards);

    if (trainerCount > getMaxTrainerCardsPerPack(packRule)) {
      violations.push({
        reason: "trainerCountPerPackExceeded",
        packNo: pack.packNo,
        trainerCount
      });
    }

    for (const card of pack.cards) {
      if (!isCountedTrainerCard(card, rule)) {
        continue;
      }

      const trainerType = String(card.trainerType || "");

      if (trainerType in trainerPlan.targetCounts) {
        actualCounts[trainerType] =
          (actualCounts[trainerType] || 0) + 1;
      }
    }
  }

  for (
    const [trainerType, targetCount] of
    Object.entries(trainerPlan.targetCounts)
  ) {
    const actualCount = actualCounts[trainerType] || 0;

    if (actualCount !== targetCount) {
      violations.push({
        reason: "trainerTypeCountMismatch",
        trainerType,
        targetCount,
        actualCount
      });
    }
  }

  for (const pairRule of trainerPlan.pairedCardRules) {
    violations.push(...validatePairedTrainerSequence(
      packs,
      pairRule,
      rule
    ));
  }

  return {
    success: violations.length === 0,
    violations
  };
}

function validatePairedTrainerSequence(packs, pairRule, rule) {
  const suffixes = pairRule.nameSuffixes;
  const trainerType = pairRule.trainerType;
  const violations = [];
  let expectedCounterpart = null;

  for (const pack of packs) {
    for (let slotIndex = 0; slotIndex < pack.cards.length; slotIndex += 1) {
      const card = pack.cards[slotIndex];

      if (
        !isCountedTrainerCard(card, rule) ||
        String(card.trainerType || "") !== trainerType
      ) {
        continue;
      }

      const pairInfo = getPairedCardInfo(card, suffixes);

      if (expectedCounterpart) {
        if (
          !pairInfo ||
          pairInfo.baseName !== expectedCounterpart.baseName ||
          pairInfo.suffix !== expectedCounterpart.suffix
        ) {
          violations.push({
            reason: "pairedTrainerCounterpartMismatch",
            packNo: pack.packNo,
            slotIndex,
            expected: expectedCounterpart,
            actualName: card.name
          });
          expectedCounterpart = null;
          continue;
        }

        expectedCounterpart = null;
        continue;
      }

      if (!pairInfo) {
        continue;
      }

      const counterpartSuffix = suffixes.find(suffix => {
        return suffix !== pairInfo.suffix;
      });

      expectedCounterpart = {
        baseName: pairInfo.baseName,
        suffix: counterpartSuffix
      };
    }
  }

  if (expectedCounterpart) {
    violations.push({
      reason: "pairedTrainerCounterpartMissingAtEnd",
      expected: expectedCounterpart
    });
  }

  return violations;
}

/**
 * ルールJSONの boxRules.boxCardCopyLimits を参照し、
 * 1BOX内におけるカード単位の最低枚数・最大枚数を調整する。
 *
 * 例:
 * "boxCardCopyLimits": {
 *   "C": { "minPerCard": 1, "maxPerCard": 4 },
 *   "U": { "minPerCard": 1, "maxPerCard": 3 }
 * }
 *
 * 同じレアリティ同士で差し替えるため、
 * BOX全体のC/U枚数やR以上の封入枚数は変わらない。
 */
function applyBoxCardCopyLimits(packs, cards, packRule) {
  const limitsByRarity = getBoxCardCopyLimits(packRule);
  const violations = [];

  for (const [rarity, limit] of Object.entries(limitsByRarity)) {
    const result = applyRarityCardCopyLimit(
      packs,
      cards,
      packRule,
      rarity,
      limit
    );

    if (!result.success) {
      violations.push(...result.violations);
    }
  }

  return {
    success: violations.length === 0,
    violations
  };
}

function applyRarityCardCopyLimit(
  packs,
  cards,
  packRule,
  rarity,
  limit
) {
  const masterCards = cards.filter(card => {
    return card.rarity === rarity;
  });

  if (masterCards.length === 0) {
    return {
      success: true,
      violations: []
    };
  }

  const minPerCard = limit.minPerCard;
  const maxPerCard = limit.maxPerCard;
  const counts = countCardsInPacks(packs);

  const totalRarityCards = masterCards.reduce((sum, card) => {
    return sum + (counts.get(getCardId(card)) || 0);
  }, 0);

  const minimumRequired = masterCards.length * minPerCard;
  const maximumCapacity = Number.isFinite(maxPerCard)
    ? masterCards.length * maxPerCard
    : Number.POSITIVE_INFINITY;

  if (
    totalRarityCards < minimumRequired ||
    totalRarityCards > maximumCapacity
  ) {
    return {
      success: false,
      violations: [{
        rarity,
        reason: "capacity",
        totalRarityCards,
        cardTypeCount: masterCards.length,
        minPerCard,
        maxPerCard
      }]
    };
  }

  const maxOperations = Math.max(
    200,
    totalRarityCards * masterCards.length * 2
  );

  for (let operation = 0; operation < maxOperations; operation += 1) {
    const underMinimumCards = masterCards
      .filter(card => {
        return (counts.get(getCardId(card)) || 0) < minPerCard;
      })
      .sort((a, b) => {
        const trainerDiff =
          Number(isTrainer(b)) - Number(isTrainer(a));

        if (trainerDiff !== 0) {
          return trainerDiff;
        }

        return (
          (counts.get(getCardId(a)) || 0) -
          (counts.get(getCardId(b)) || 0)
        );
      });

    const overMaximumCards = masterCards
      .filter(card => {
        return (
          Number.isFinite(maxPerCard) &&
          (counts.get(getCardId(card)) || 0) > maxPerCard
        );
      })
      .sort((a, b) => {
        return (
          (counts.get(getCardId(b)) || 0) -
          (counts.get(getCardId(a)) || 0)
        );
      });

    if (
      underMinimumCards.length === 0 &&
      overMaximumCards.length === 0
    ) {
      return {
        success: true,
        violations: []
      };
    }

    let sourceCards = [];
    let targetCards = [];

    if (underMinimumCards.length > 0) {
      targetCards = underMinimumCards;

      // 最低枚数を割らずに差し替えられるカードを使用する。
      // 最大超過しているカードを最優先にする。
      sourceCards = masterCards
        .filter(card => {
          return (counts.get(getCardId(card)) || 0) > minPerCard;
        })
        .sort((a, b) => {
          const aCount = counts.get(getCardId(a)) || 0;
          const bCount = counts.get(getCardId(b)) || 0;
          const aOver = Number.isFinite(maxPerCard)
            ? Math.max(0, aCount - maxPerCard)
            : 0;
          const bOver = Number.isFinite(maxPerCard)
            ? Math.max(0, bCount - maxPerCard)
            : 0;

          if (aOver !== bOver) {
            return bOver - aOver;
          }

          return bCount - aCount;
        });
    } else {
      sourceCards = overMaximumCards;

      targetCards = masterCards
        .filter(card => {
          return (
            !Number.isFinite(maxPerCard) ||
            (counts.get(getCardId(card)) || 0) < maxPerCard
          );
        })
        .sort((a, b) => {
          const trainerDiff =
            Number(isTrainer(b)) - Number(isTrainer(a));

          if (trainerDiff !== 0) {
            return trainerDiff;
          }

          return (
            (counts.get(getCardId(a)) || 0) -
            (counts.get(getCardId(b)) || 0)
          );
        });
    }

    const replacement = findCardCountLimitReplacement(
      packs,
      sourceCards,
      targetCards,
      counts,
      packRule,
      minPerCard
    );

    if (!replacement) {
      break;
    }

    const {
      packIndex,
      slotIndex,
      sourceCard,
      targetCard
    } = replacement;

    packs[packIndex].cards[slotIndex] = targetCard;

    const sourceCardId = getCardId(sourceCard);
    const targetCardId = getCardId(targetCard);

    counts.set(
      sourceCardId,
      (counts.get(sourceCardId) || 0) - 1
    );

    counts.set(
      targetCardId,
      (counts.get(targetCardId) || 0) + 1
    );
  }

  const violations = masterCards
    .map(card => {
      const count = counts.get(getCardId(card)) || 0;

      if (
        count < minPerCard ||
        (
          Number.isFinite(maxPerCard) &&
          count > maxPerCard
        )
      ) {
        return {
          rarity,
          cardNo: card.cardNo,
          name: card.name,
          count,
          minPerCard,
          maxPerCard
        };
      }

      return null;
    })
    .filter(Boolean);

  return {
    success: violations.length === 0,
    violations
  };
}

function findCardCountLimitReplacement(
  packs,
  sourceCards,
  targetCards,
  counts,
  packRule,
  sourceMinimum
) {
  const candidates = [];

  for (const targetCard of targetCards) {
    const targetCardId = getCardId(targetCard);

    for (const sourceCard of sourceCards) {
      const sourceCardId = getCardId(sourceCard);
      const sourceCount = counts.get(sourceCardId) || 0;

      if (sourceCount <= sourceMinimum) {
        continue;
      }

      if (
        !areCopyLimitCardsCompatible(
          sourceCard,
          targetCard,
          packRule
        )
      ) {
        continue;
      }

      for (
        let packIndex = 0;
        packIndex < packs.length;
        packIndex += 1
      ) {
        const pack = packs[packIndex];

        // 1パック内に同一カードを2枚入れない。
        if (
          pack.cards.some(card => {
            return getCardId(card) === targetCardId;
          })
        ) {
          continue;
        }

        for (
          let slotIndex = 0;
          slotIndex < pack.cards.length;
          slotIndex += 1
        ) {
          const currentCard = pack.cards[slotIndex];

          if (getCardId(currentCard) !== sourceCardId) {
            continue;
          }

          if (
            !canPlaceCoverageCardInSlot(
              targetCard,
              currentCard,
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
            sourceCard,
            targetCard,
            sourceCount
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // 最も多く出ている差し替え元を優先する。
  candidates.sort((a, b) => {
    return b.sourceCount - a.sourceCount;
  });

  const highestSourceCount = candidates[0].sourceCount;
  const bestCandidates = candidates.filter(candidate => {
    return candidate.sourceCount === highestSourceCount;
  });

  return pickRandom(bestCandidates);
}

function areCopyLimitCardsCompatible(
  sourceCard,
  targetCard,
  packRule
) {
  if (!isTrainerBoxRuleEnabled(packRule)) {
    return true;
  }

  const sourceIsTrainer = isTrainer(sourceCard);
  const targetIsTrainer = isTrainer(targetCard);

  if (sourceIsTrainer !== targetIsTrainer) {
    return false;
  }

  if (!sourceIsTrainer) {
    return true;
  }

  return (
    String(sourceCard.trainerType || "") ===
    String(targetCard.trainerType || "")
  );
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

function getBoxCardCopyLimits(packRule) {
  const configuredLimits = getRuleValue(packRule, [
    ["boxRules", "boxCardCopyLimits"],
    ["boxCardCopyLimits"]
  ]);

  if (
    configuredLimits &&
    typeof configuredLimits === "object" &&
    !Array.isArray(configuredLimits)
  ) {
    const normalizedLimits = {};

    for (
      const [rarity, rawLimit] of
      Object.entries(configuredLimits)
    ) {
      if (
        !rawLimit ||
        typeof rawLimit !== "object" ||
        Array.isArray(rawLimit)
      ) {
        continue;
      }

      const minPerCard = normalizeNonNegativeInteger(
        rawLimit.minPerCard ?? rawLimit.min,
        0
      );

      const maxValue =
        rawLimit.maxPerCard ??
        rawLimit.max;

      const maxPerCard =
        maxValue === undefined ||
        maxValue === null ||
        maxValue === ""
          ? Number.POSITIVE_INFINITY
          : normalizeNonNegativeInteger(
              maxValue,
              Number.POSITIVE_INFINITY
            );

      normalizedLimits[rarity] = {
        minPerCard,
        maxPerCard: Math.max(minPerCard, maxPerCard)
      };
    }

    return normalizedLimits;
  }

  /*
   * 従来互換:
   * guaranteeCommonUncommonCoverage がfalseでなければ、
   * C/Uを最低1枚ずつ保証する。最大枚数は制限しない。
   */
  const coverageEnabled = getRuleValue(packRule, [
    ["boxRules", "guaranteeCommonUncommonCoverage"],
    ["guaranteeCommonUncommonCoverage"]
  ]);

  if (coverageEnabled === false) {
    return {};
  }

  return {
    C: {
      minPerCard: 1,
      maxPerCard: Number.POSITIVE_INFINITY
    },
    U: {
      minPerCard: 1,
      maxPerCard: Number.POSITIVE_INFINITY
    }
  };
}

function normalizeNonNegativeInteger(value, fallback) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.max(0, Math.floor(numberValue));
}

function getBoxGenerationMaxAttempts(packRule) {
  const value = getRuleValue(packRule, [
    ["boxRules", "boxGenerationMaxAttempts"],
    ["boxGenerationMaxAttempts"]
  ]);

  return normalizePositiveInteger(value, 40);
}

function normalizePositiveInteger(value, fallback) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(numberValue));
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

  const firstHitRarityWeights = getBoxHitRarityWeights(packRule);
  const additionalHitRarityWeights =
    getAdditionalBoxHitRarityWeights(packRule) ||
    firstHitRarityWeights;

  if (
    !firstHitRarityWeights ||
    Object.keys(firstHitRarityWeights).length === 0
  ) {
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

    // 1枚目は通常の重み、2枚目以降は追加ヒット専用の重みを使う。
    // ルールJSONで additionalHitRarityWeights を { "SR": 1 } とすれば、
    // 2枚箱の追加分はSRだけになる。
    const currentRarityWeights =
      i === 0
        ? firstHitRarityWeights
        : additionalHitRarityWeights;

    const selectedRarity = pickWeightedRarity(
      availableCards,
      currentRarityWeights
    );

    if (!selectedRarity) {
      console.warn(
        "抽選可能な高レアリティがありません。",
        {
          hitIndex: i + 1,
          rarityWeights: currentRarityWeights,
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

function getAdditionalBoxHitRarityWeights(packRule) {
  return getRuleValue(packRule, [
    ["boxRules", "boxHit", "additionalHitRarityWeights"],
    ["boxRules", "boxHit", "extraHitRarityWeights"],
    ["boxRules", "boxHit", "secondHitRarityWeights"],
    ["boxHit", "additionalHitRarityWeights"],
    ["additionalBoxHitRarityWeights"]
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

function buildPackCards({
  pools,
  packRule,
  slot4Card,
  packIndex,
  trainerPlan
}) {
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
    const plannedTrainerCard = trainerPlan.enabled
      ? trainerPlan.assignments.get(
          getTrainerAssignmentKey(packIndex, slotName)
        )
      : null;

    if (plannedTrainerCard) {
      return plannedTrainerCard;
    }

    // BOX単位のトレーナー枚数ルールが有効な場合、
    // 計画にない枠では追加のトレーナー抽選を行わない。
    if (trainerPlan.enabled) {
      return pickUniqueCard(
        nonTrainerPool,
        getBlockedIdsForRandomPick()
      );
    }

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
      !trainerPlan.enabled &&
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
  const name = String(card.name || "");

  // 2枚1組カードは公式IDが共通でも別カードとして扱う。
  if (name.endsWith("-L") || name.endsWith("-R")) {
    return [
      card.setCode || "",
      card.officialCardId || "",
      card.cardNo || "",
      card.rarity || "",
      name
    ].join("_");
  }

  return String(
    card.officialCardId ||
    `${card.setCode || ""}_${card.cardNo || ""}_${card.rarity || ""}_${name}`
  );
}

function isTrainer(card) {
  if (!card) {
    return false;
  }

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