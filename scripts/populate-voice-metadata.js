#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CURRICULUM_DIR = path.join(ROOT, "preschool-curriculum");

// Canonical + alias tables aligned with web-poc/spike-voice/vocab-matcher.js
const NUMBER_UTTERANCES = {
  0: ["zero", "0", "oh"],
  1: ["one", "1", "won"],
  2: ["two", "2", "to", "too"],
  3: ["three", "3", "tree"],
  4: ["four", "4", "for", "fore"],
  5: ["five", "5"],
  6: ["six", "6", "sicks"],
  7: ["seven", "7"],
  8: ["eight", "8", "ate"],
  9: ["nine", "9"],
  10: ["ten", "10"],
  11: ["eleven", "11"],
  12: ["twelve", "12"],
  13: ["thirteen", "13"],
  14: ["fourteen", "14"],
  15: ["fifteen", "15"],
  16: ["sixteen", "16"],
  17: ["seventeen", "17"],
  18: ["eighteen", "18"],
  19: ["nineteen", "19"],
  20: ["twenty", "20"],
};

const WORD_TO_NUMBER = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const ORDINAL_MAP = [
  { regex: /\b(1st|first)\b/i, utterances: ["first", "1st", "one", "1"] },
  { regex: /\b(2nd|second)\b/i, utterances: ["second", "2nd", "two", "2"] },
  { regex: /\b(3rd|third)\b/i, utterances: ["third", "3rd", "three", "3"] },
];

// Acoustically confusable numeral pairs in English preschool ASR
const ACOUSTIC_NUMBER_PAIRS = [
  [5, 9],
  [7, 11],
  [13, 14],
  [14, 15],
  [16, 6],
  [17, 7],
  [18, 8],
  [19, 9],
];

const COLOR_MAP = {
  red: { utterances: ["red", "read"], mode: "direct_word" },
  blue: { utterances: ["blue", "blew"], mode: "direct_word" },
  yellow: { utterances: ["yellow"], mode: "direct_word" },
  green: { utterances: ["green"], mode: "direct_word" },
  orange: { utterances: ["orange"], mode: "direct_word" },
  purple: { utterances: ["purple"], mode: "direct_word" },
  pink: { utterances: ["pink"], mode: "direct_word" },
  brown: { utterances: ["brown"], mode: "direct_word" },
  black: { utterances: ["black"], mode: "direct_word" },
  white: { utterances: ["white"], mode: "direct_word" },
  gray: { utterances: ["gray", "grey"], mode: "synonym_set" },
  grey: { utterances: ["gray", "grey"], mode: "synonym_set" },
};

const MEASUREMENT_SYNONYMS = {
  big: ["big", "large"],
  large: ["large", "big"],
  small: ["small", "little", "tiny"],
  little: ["little", "small"],
  tall: ["tall", "high"],
  short: ["short"],
  long: ["long"],
  heavy: ["heavy"],
  light: ["light"],
  full: ["full"],
  empty: ["empty"],
  hot: ["hot", "warm"],
  cold: ["cold", "freezing"],
  fast: ["fast", "quick"],
  slow: ["slow"],
  wide: ["wide"],
  narrow: ["narrow", "skinny"],
  thick: ["thick"],
  thin: ["thin", "skinny"],
  loud: ["loud", "noisy"],
  quiet: ["quiet", "soft"],
  more: ["more"],
  less: ["less", "fewer"],
  fewer: ["fewer", "less"],
  same: ["same", "equal"],
  different: ["different"],
  open: ["open"],
  closed: ["closed", "shut"],
  wet: ["wet"],
  dry: ["dry"],
  clean: ["clean"],
  dirty: ["dirty", "messy"],
  dark: ["dark"],
  hard: ["hard"],
  soft: ["soft"],
  rough: ["rough", "bumpy"],
  smooth: ["smooth"],
  sink: ["sink", "sinking"],
  float: ["float", "floating"],
  straight: ["straight"],
  curved: ["curved", "curvy"],
  whole: ["whole"],
  part: ["part", "half"],
};

function normalizeUtterance(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(arr) {
  const out = [];
  const seen = new Set();
  for (const val of arr) {
    const clean = normalizeUtterance(val);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function extractNumberValue(item) {
  // Check exact numeric display_token first (e.g., "0".."20")
  if (typeof item.display_token === "string" && /^\d+$/.test(item.display_token.trim())) {
    const n = parseInt(item.display_token.trim(), 10);
    if (Object.prototype.hasOwnProperty.call(NUMBER_UTTERANCES, n)) return n;
  }

  // Strip frame names ("five-frame", "ten-frame") so "five"/"ten" isn't misread as the item's quantity
  const cleanedLabel = String(item.label || "")
    .toLowerCase()
    .replace(/\b(five|ten)[\s-]+frame(s)?\b/g, " ");

  const digitMatch = cleanedLabel.match(/\b(\d+)\b/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (Object.prototype.hasOwnProperty.call(NUMBER_UTTERANCES, n)) return n;
  }

  const words = cleanedLabel.replace(/[^a-z0-9\s]+/g, " ").split(/\s+/);
  for (const w of words) {
    if (Object.prototype.hasOwnProperty.call(WORD_TO_NUMBER, w)) {
      return WORD_TO_NUMBER[w];
    }
  }

  // Fallback to trailing number in item.id (e.g., "num-dots-4")
  const idMatch = String(item.id || "").match(/-(\d+)$/);
  if (idMatch) {
    const n = parseInt(idMatch[1], 10);
    if (Object.prototype.hasOwnProperty.call(NUMBER_UTTERANCES, n)) return n;
  }

  return null;
}

function enrichNumbersItems(items) {
  const valueToIds = new Map();
  const numeralValueToId = new Map();

  for (const item of items) {
    const labelText = `${item.label || ""} ${item.display_token || ""}`;
    let matchedOrdinal = null;
    for (const ord of ORDINAL_MAP) {
      if (ord.regex.test(labelText)) {
        matchedOrdinal = ord;
        break;
      }
    }

    if (matchedOrdinal) {
      item.voice_recall_mode = "synonym_set";
      item.accepted_utterances = dedupe(matchedOrdinal.utterances);
      continue;
    }

    const numVal = extractNumberValue(item);
    if (numVal !== null && NUMBER_UTTERANCES[numVal]) {
      item.voice_recall_mode = "direct_word";
      item.accepted_utterances = dedupe(NUMBER_UTTERANCES[numVal]);
      if (!valueToIds.has(numVal)) valueToIds.set(numVal, []);
      valueToIds.get(numVal).push(item.id);
      if (item.visual_type === "numeral_glyph") {
        numeralValueToId.set(numVal, item.id);
      }
    } else {
      item.voice_recall_mode = "guided_only";
      item.accepted_utterances = [];
    }
  }

  // Build symmetric confusable_with sets:
  // 1) Same-quantity visuals (e.g., numeral 3, dice 3, fingers 3, five-frame 3, tally 3)
  // 2) Acoustically confusable numeral pairs (e.g., 5 <-> 9, 7 <-> 11)
  const confMap = new Map(items.map((it) => [it.id, new Set()]));

  for (const ids of valueToIds.values()) {
    if (ids.length > 1) {
      for (const a of ids) {
        for (const b of ids) {
          if (a !== b) confMap.get(a).add(b);
        }
      }
    }
  }

  for (const [nA, nB] of ACOUSTIC_NUMBER_PAIRS) {
    const idA = numeralValueToId.get(nA);
    const idB = numeralValueToId.get(nB);
    if (idA && idB && idA !== idB) {
      confMap.get(idA).add(idB);
      confMap.get(idB).add(idA);
    }
  }

  for (const item of items) {
    const refs = Array.from(confMap.get(item.id)).sort();
    if (refs.length > 0) {
      item.confusable_with = refs;
    } else {
      delete item.confusable_with;
    }
  }
}

function enrichColorsMeasurementItems(items) {
  const utteranceToIds = new Map();

  for (const item of items) {
    const rawLabel = String(item.label || "").trim();
    const normLabel = normalizeUtterance(rawLabel);

    // 1. Check 11 core colors first
    let matchedColor = null;
    if (item.visual_type === "color_swatch" || Object.prototype.hasOwnProperty.call(COLOR_MAP, normLabel)) {
      const tokens = normLabel.split(/\s+/);
      for (const t of tokens) {
        if (Object.prototype.hasOwnProperty.call(COLOR_MAP, t)) {
          matchedColor = COLOR_MAP[t];
          break;
        }
      }
    }

    if (matchedColor) {
      item.voice_recall_mode = matchedColor.mode;
      item.accepted_utterances = dedupe(matchedColor.utterances);
    } else if (
      item.visual_type === "comparison_pair" ||
      /\bvs\.?\b|\band\b|\/|&/i.test(rawLabel)
    ) {
      // Paired visual contrast cards (e.g., "Big vs. Small") require a guided audio prompt
      item.voice_recall_mode = "guided_only";
      item.accepted_utterances = [];
    } else if (Object.prototype.hasOwnProperty.call(MEASUREMENT_SYNONYMS, normLabel)) {
      const syns = dedupe(MEASUREMENT_SYNONYMS[normLabel]);
      item.voice_recall_mode = syns.length > 1 ? "synonym_set" : "direct_word";
      item.accepted_utterances = syns;
    } else {
      // Single-word fallback if label is a single clean concept, else guided_only
      const tokens = normLabel.split(/\s+/).filter(Boolean);
      if (tokens.length === 1) {
        item.voice_recall_mode = "direct_word";
        item.accepted_utterances = [tokens[0]];
      } else {
        item.voice_recall_mode = "guided_only";
        item.accepted_utterances = [];
      }
    }

    for (const utt of item.accepted_utterances) {
      if (!utteranceToIds.has(utt)) utteranceToIds.set(utt, []);
      utteranceToIds.get(utt).push(item.id);
    }
  }

  // Link any items in this file that share an accepted utterance (e.g., "light" weight vs "light" brightness)
  const confMap = new Map(items.map((it) => [it.id, new Set()]));
  for (const ids of utteranceToIds.values()) {
    if (ids.length > 1) {
      for (const a of ids) {
        for (const b of ids) {
          if (a !== b) confMap.get(a).add(b);
        }
      }
    }
  }

  for (const item of items) {
    const refs = Array.from(confMap.get(item.id)).sort();
    if (refs.length > 0) {
      item.confusable_with = refs;
    } else {
      delete item.confusable_with;
    }
  }
}

function syncCoreToComprehensive(coreItems, compItems) {
  const coreById = new Map(coreItems.map((it) => [it.id, it]));
  let synced = 0;
  for (const compItem of compItems) {
    const coreItem = coreById.get(compItem.id);
    if (!coreItem) continue;
    compItem.voice_recall_mode = coreItem.voice_recall_mode;
    compItem.accepted_utterances = coreItem.accepted_utterances.slice();
    if (Array.isArray(coreItem.confusable_with) && coreItem.confusable_with.length > 0) {
      compItem.confusable_with = coreItem.confusable_with.slice();
    } else {
      delete compItem.confusable_with;
    }
    synced++;
  }
  return synced;
}

function run(baseDir) {
  const dir = baseDir || CURRICULUM_DIR;

  const files = [
    { name: "02_numbers_quantities.json", enrich: enrichNumbersItems },
    { name: "05_colors_measurement.json", enrich: enrichColorsMeasurementItems },
  ];

  const summary = [];
  for (const { name, enrich } of files) {
    const corePath = path.join(dir, "core", name);
    const compPath = path.join(dir, "comprehensive", name);
    const coreData = JSON.parse(fs.readFileSync(corePath, "utf8"));
    const compData = JSON.parse(fs.readFileSync(compPath, "utf8"));

    enrich(coreData.items);
    const synced = syncCoreToComprehensive(coreData.items, compData.items);

    fs.writeFileSync(corePath, JSON.stringify(coreData, null, 2) + "\n", "utf8");
    fs.writeFileSync(compPath, JSON.stringify(compData, null, 2) + "\n", "utf8");

    const modeCounts = coreData.items.reduce((acc, it) => {
      acc[it.voice_recall_mode] = (acc[it.voice_recall_mode] || 0) + 1;
      return acc;
    }, {});
    summary.push({ file: name, coreCount: coreData.items.length, syncedToComp: synced, modeCounts });
  }

  return summary;
}

if (require.main === module) {
  const summary = run(CURRICULUM_DIR);
  for (const s of summary) {
    console.log(
      `POPULATED ${s.file} | core=${s.coreCount}, syncedToComprehensive=${s.syncedToComp}, modes=${JSON.stringify(s.modeCounts)}`
    );
  }
}

module.exports = { run, normalizeUtterance };
