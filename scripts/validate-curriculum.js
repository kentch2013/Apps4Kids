#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_DIR = path.join(ROOT, "preschool-curriculum");

const DOMAIN_FILES = [
  { file: "01_letters.json", domain: "letters", coreMin: 52, coreMax: 58, compMin: 80 },
  { file: "02_numbers_quantities.json", domain: "numbers_quantities", coreMin: 55, coreMax: 70, compMin: 140 },
  { file: "03_symbols_icons.json", domain: "symbols_icons", coreMin: 32, coreMax: 45, compMin: 80 },
  { file: "04_shapes_spatial.json", domain: "shapes_spatial", coreMin: 36, coreMax: 48, compMin: 90 },
  { file: "05_colors_measurement.json", domain: "colors_measurement", coreMin: 32, coreMax: 45, compMin: 80 },
  { file: "06_time_money.json", domain: "time_money", coreMin: 22, coreMax: 32, compMin: 60 },
  { file: "07_science_nature.json", domain: "science_nature", coreMin: 70, coreMax: 90, compMin: 230 },
  { file: "08_social_community.json", domain: "social_community", coreMin: 40, coreMax: 55, compMin: 120 },
  { file: "09_emotions_everyday.json", domain: "emotions_everyday", coreMin: 30, coreMax: 42, compMin: 100 }
];

const VERTICAL_SLICE_CORE_FILES = new Set([
  "02_numbers_quantities.json",
  "05_colors_measurement.json"
]);

const VALID_VISUAL_TYPES = new Set([
  "letter_glyph",
  "numeral_glyph",
  "quantity_visual",
  "symbol_glyph",
  "shape_geometry",
  "color_swatch",
  "pattern_sequence",
  "clock_visual",
  "currency_visual",
  "diagram_illustration",
  "pictogram_sign",
  "comparison_pair"
]);

const VALID_VOICE_RECALL_MODES = new Set([
  "direct_word",
  "synonym_set",
  "confusable_phoneme",
  "guided_only"
]);

const VALID_TIERS = new Set([1, 2, 3, 4]);
const ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const MULTI_LETTER_WORD_REGEX = /[A-Za-z]{2,}/;
const UTTERANCE_REGEX = /^[a-z0-9]+(?: [a-z0-9]+)*$/;

function validateItemVoiceFields(item, knownIds, loc, options) {
  const opts = options || {};
  const requireVoiceFields = Boolean(opts.requireVoiceFields);
  const itemErrors = [];

  const hasMode = Object.prototype.hasOwnProperty.call(item, "voice_recall_mode");
  const hasUtterances = Object.prototype.hasOwnProperty.call(item, "accepted_utterances");
  const hasConfusable = Object.prototype.hasOwnProperty.call(item, "confusable_with");

  if (requireVoiceFields && !hasMode) {
    itemErrors.push(`${loc}: missing required voice_recall_mode`);
  }
  if (requireVoiceFields && !hasUtterances) {
    itemErrors.push(`${loc}: missing required accepted_utterances`);
  }

  let mode = null;
  if (hasMode) {
    if (typeof item.voice_recall_mode !== "string" || !VALID_VOICE_RECALL_MODES.has(item.voice_recall_mode)) {
      itemErrors.push(
        `${loc}: invalid voice_recall_mode "${item.voice_recall_mode}" (allowed: ${Array.from(VALID_VOICE_RECALL_MODES).join(", ")})`
      );
    } else {
      mode = item.voice_recall_mode;
    }
  }

  if (hasUtterances) {
    if (!Array.isArray(item.accepted_utterances)) {
      itemErrors.push(`${loc}: accepted_utterances must be an array of normalized strings`);
    } else {
      const seenUtterances = new Set();
      for (const utt of item.accepted_utterances) {
        if (typeof utt !== "string" || !UTTERANCE_REGEX.test(utt)) {
          itemErrors.push(
            `${loc}: invalid accepted_utterance ${JSON.stringify(utt)} (must be lowercase, punctuation-stripped, single-spaced)`
          );
        } else if (seenUtterances.has(utt)) {
          itemErrors.push(`${loc}: duplicate accepted_utterance "${utt}"`);
        } else {
          seenUtterances.add(utt);
        }
      }
      if (mode && mode !== "guided_only" && item.accepted_utterances.length === 0) {
        itemErrors.push(`${loc}: voice_recall_mode "${mode}" requires non-empty accepted_utterances`);
      }
    }
  } else if (mode && mode !== "guided_only") {
    itemErrors.push(`${loc}: voice_recall_mode "${mode}" requires accepted_utterances array`);
  }

  if (hasConfusable) {
    if (!Array.isArray(item.confusable_with)) {
      itemErrors.push(`${loc}: confusable_with must be an array of item IDs`);
    } else {
      const seenRefs = new Set();
      for (const refId of item.confusable_with) {
        if (typeof refId !== "string" || !ID_REGEX.test(refId)) {
          itemErrors.push(`${loc}: invalid confusable_with ID ${JSON.stringify(refId)}`);
        } else if (refId === item.id) {
          itemErrors.push(`${loc}: confusable_with must not self-reference "${refId}"`);
        } else if (seenRefs.has(refId)) {
          itemErrors.push(`${loc}: duplicate confusable_with ID "${refId}"`);
        } else {
          seenRefs.add(refId);
          if (knownIds && !knownIds.has(refId)) {
            itemErrors.push(`${loc}: dangling confusable_with reference "${refId}" not found in dataset`);
          }
        }
      }
    }
  }

  return itemErrors;
}

function validateCurriculum(baseDir) {
  const dir = baseDir || BASE_DIR;
  const errors = [];

  function fail(msg) {
    errors.push(msg);
  }

  function readJson(filePath) {
    if (!fs.existsSync(filePath)) {
      fail(`Missing required file: ${path.relative(ROOT, filePath)}`);
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      fail(`Invalid JSON in ${path.relative(ROOT, filePath)}: ${err.message}`);
      return null;
    }
  }

  function validateMetadataFiles() {
    const schema = readJson(path.join(dir, "schema.json"));
    const taxonomy = readJson(path.join(dir, "taxonomy.json"));
    if (schema && typeof schema !== "object") fail("schema.json must be a JSON object");
    if (taxonomy) {
      if (!Array.isArray(taxonomy.domains) || taxonomy.domains.length !== 9) {
        fail("taxonomy.json must define exactly 9 domains");
      }
      if (!Array.isArray(taxonomy.tiers) || taxonomy.tiers.length !== 4) {
        fail("taxonomy.json must define exactly 4 difficulty tiers");
      }
    }
  }

  function validateItem(item, expectedDomain, setName, fileName, seenIds) {
    const loc = `${setName}/${fileName} [${item && item.id ? item.id : "UNKNOWN_ID"}]`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(`${loc}: item must be an object`);
      return;
    }

    if (typeof item.id !== "string" || !ID_REGEX.test(item.id)) {
      fail(`${loc}: invalid id format (must be kebab-case with at least one hyphen)`);
    } else if (seenIds.has(item.id)) {
      fail(`${loc}: duplicate id "${item.id}" in ${setName}`);
    } else {
      seenIds.add(item.id);
    }

    if (typeof item.label !== "string" || item.label.trim().length < 1) {
      fail(`${loc}: label must be a non-empty string`);
    }

    if (item.domain !== expectedDomain) {
      fail(`${loc}: domain "${item.domain}" does not match file domain "${expectedDomain}"`);
    }

    if (typeof item.category !== "string" || item.category.trim().length < 2) {
      fail(`${loc}: category must be a non-empty string`);
    }

    if (!VALID_TIERS.has(item.tier)) {
      fail(`${loc}: tier must be 1, 2, 3, or 4 (got ${item.tier})`);
    }

    if (!VALID_VISUAL_TYPES.has(item.visual_type)) {
      fail(`${loc}: invalid visual_type "${item.visual_type}"`);
    }

    if (item.display_token !== null && item.display_token !== undefined) {
      if (typeof item.display_token !== "string") {
        fail(`${loc}: display_token must be a string or null`);
      } else if (!HEX_COLOR_REGEX.test(item.display_token)) {
        if (MULTI_LETTER_WORD_REGEX.test(item.display_token)) {
          fail(`${loc}: display_token "${item.display_token}" violates visual-only rule (contains multi-letter English word)`);
        }
      }
    }

    if (typeof item.visual_prompt !== "string" || item.visual_prompt.trim().length < 12) {
      fail(`${loc}: visual_prompt must be a descriptive string (>= 12 chars)`);
    }

    if (typeof item.audio_prompt !== "string" || item.audio_prompt.trim().length < 5) {
      fail(`${loc}: audio_prompt must be a non-empty spoken cue (>= 5 chars)`);
    }

    if (
      !Array.isArray(item.standard_refs) ||
      item.standard_refs.length < 1 ||
      !item.standard_refs.every((s) => typeof s === "string" && s.trim().length > 2)
    ) {
      fail(`${loc}: standard_refs must be a non-empty array of US standard codes`);
    }

    if (typeof item.distractor_group !== "string" || item.distractor_group.trim().length < 2) {
      fail(`${loc}: distractor_group must be a non-empty string`);
    }

    if (typeof item.in_core !== "boolean") {
      fail(`${loc}: in_core must be a boolean`);
    } else if (setName === "core" && item.in_core !== true) {
      fail(`${loc}: all items in core/ must have in_core: true`);
    }
  }

  function validateSet(setName) {
    const seenIds = new Set();
    const idToDomain = new Map();
    const idToItem = new Map();
    const loadedFiles = [];
    const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let total = 0;

    for (const spec of DOMAIN_FILES) {
      const filePath = path.join(dir, setName, spec.file);
      const data = readJson(filePath);
      if (!data) continue;

      if (!Array.isArray(data.items)) {
        fail(`${setName}/${spec.file}: must have top-level "items" array`);
        continue;
      }

      if (data.set !== setName) {
        fail(`${setName}/${spec.file}: top-level "set" must be "${setName}"`);
      }
      if (data.domain !== spec.domain) {
        fail(`${setName}/${spec.file}: top-level "domain" must be "${spec.domain}"`);
      }

      const count = data.items.length;
      total += count;

      if (setName === "core") {
        if (count < spec.coreMin || count > spec.coreMax) {
          fail(`core/${spec.file}: count ${count} outside target range [${spec.coreMin}, ${spec.coreMax}]`);
        }
      } else {
        if (count < spec.compMin) {
          fail(`comprehensive/${spec.file}: count ${count} below minimum ${spec.compMin}`);
        }
      }

      loadedFiles.push({ spec, items: data.items });

      for (const item of data.items) {
        validateItem(item, spec.domain, setName, spec.file, seenIds);
        if (item && typeof item.id === "string") {
          idToDomain.set(item.id, item.domain);
          idToItem.set(item.id, item);
        }
        if (item && VALID_TIERS.has(item.tier)) {
          tierCounts[item.tier] += 1;
        }
      }
    }

    // Second pass: validate voice fields & cross-item confusable_with references against full set IDs
    for (const entry of loadedFiles) {
      const requireVoiceFields = setName === "core" && VERTICAL_SLICE_CORE_FILES.has(entry.spec.file);
      for (const item of entry.items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const loc = `${setName}/${entry.spec.file} [${item.id || "UNKNOWN_ID"}]`;
        const voiceErrs = validateItemVoiceFields(item, seenIds, loc, { requireVoiceFields });
        for (const err of voiceErrs) fail(err);
      }
    }

    for (const t of [1, 2, 3, 4]) {
      if (tierCounts[t] === 0) {
        fail(`${setName}: missing items for difficulty tier ${t}`);
      }
    }

    return { total, seenIds, idToDomain, idToItem, tierCounts };
  }

  validateMetadataFiles();
  const core = validateSet("core");
  const comp = validateSet("comprehensive");

  if (core.total < 380 || core.total > 450) {
    fail(`core total count ${core.total} outside target range [380, 450]`);
  }
  if (comp.total < 1000) {
    fail(`comprehensive total count ${comp.total} below minimum 1000`);
  }

  // Superset check: every Core ID must exist in Comprehensive with matching domain
  for (const [id, domain] of core.idToDomain.entries()) {
    if (!comp.idToDomain.has(id)) {
      fail(`Superset violation: core id "${id}" missing from comprehensive/`);
    } else if (comp.idToDomain.get(id) !== domain) {
      fail(`Superset violation: id "${id}" domain mismatch (core="${domain}", comprehensive="${comp.idToDomain.get(id)}")`);
    }
  }

  return { errors, core, comp };
}

if (require.main === module) {
  const { errors, core, comp } = validateCurriculum(BASE_DIR);
  if (errors.length > 0) {
    console.error(`VALIDATION FAILED (${errors.length} errors):`);
    for (const e of errors.slice(0, 40)) {
      console.error(`  - ${e}`);
    }
    if (errors.length > 40) {
      console.error(`  ... and ${errors.length - 40} more errors.`);
    }
    process.exit(1);
  }

  console.log(
    `VALIDATION PASSED | Core: ${core.total} items (T1:${core.tierCounts[1]}, T2:${core.tierCounts[2]}, T3:${core.tierCounts[3]}, T4:${core.tierCounts[4]}) | Comprehensive: ${comp.total} items (T1:${comp.tierCounts[1]}, T2:${comp.tierCounts[2]}, T3:${comp.tierCounts[3]}, T4:${comp.tierCounts[4]})`
  );
}

module.exports = {
  DOMAIN_FILES,
  VERTICAL_SLICE_CORE_FILES,
  VALID_VISUAL_TYPES,
  VALID_VOICE_RECALL_MODES,
  UTTERANCE_REGEX,
  validateItemVoiceFields,
  validateCurriculum,
};
