#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_DIR = path.join(ROOT, "preschool-curriculum");

const FILES = [
  "01_letters.json",
  "02_numbers_quantities.json",
  "03_symbols_icons.json",
  "04_shapes_spatial.json",
  "05_colors_measurement.json",
  "06_time_money.json",
  "07_science_nature.json",
  "08_social_community.json",
  "09_emotions_everyday.json"
];

const BAD_PROPER_NOUNS = [
  /\bus\b/,
  /\babraham lincoln\b/,
  /\bgeorge washington\b/,
  /\bthomas jefferson\b/,
  /\bfranklin roosevelt\b/,
  /\bstatue of liberty\b/,
  /\bliberty bell\b/,
  /\bwhite house\b/
];

const GENERIC_PHRASES = [
  /with typical gear/i,
  /typical items/i
];

const EMBEDDED_TEXT_PHRASES = [
  /\btext reading\b/i,
  /\bsays\s+["'][A-Za-z]{2,}["']/i,
  /\bword\s+["'][A-Za-z]{2,}["']/i,
  /\blabeled\s+["'][A-Za-z]{2,}["']/i
];

const errors = [];
const summaryLines = [];

function auditSet(setName) {
  const distractorCounts = new Map();
  let total = 0;
  summaryLines.push(`=== ${setName.toUpperCase()} ===`);

  for (const file of FILES) {
    const data = JSON.parse(fs.readFileSync(path.join(BASE_DIR, setName, file), "utf8"));
    const items = data.items || [];
    const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
    total += items.length;

    for (const item of items) {
      tiers[item.tier] = (tiers[item.tier] || 0) + 1;
      distractorCounts.set(item.distractor_group, (distractorCounts.get(item.distractor_group) || 0) + 1);

      for (const rx of BAD_PROPER_NOUNS) {
        if (rx.test(item.visual_prompt)) {
          errors.push(`${setName}/${file} [${item.id}]: uncapitalized proper noun in visual_prompt ("${item.visual_prompt}")`);
        }
      }
      for (const rx of GENERIC_PHRASES) {
        if (rx.test(item.visual_prompt)) {
          errors.push(`${setName}/${file} [${item.id}]: generic template visual_prompt ("${item.visual_prompt}")`);
        }
      }
      for (const rx of EMBEDDED_TEXT_PHRASES) {
        if (rx.test(item.visual_prompt)) {
          errors.push(`${setName}/${file} [${item.id}]: visual_prompt requests on-screen text ("${item.visual_prompt}")`);
        }
      }
      if ((item.id === "sym-greater" || item.id === "sym-less") && item.standard_refs.includes("CCSS.MATH.K.CC.C.7")) {
        errors.push(`${setName}/${file} [${item.id}]: formal inequality symbol should cite CCSS.MATH.1.NBT.B.3 (stretch) instead of K.CC.C.7`);
      }
    }

    summaryLines.push(
      `  ${file}: ${items.length} items (T1:${tiers[1]}, T2:${tiers[2]}, T3:${tiers[3]}, T4:${tiers[4]})`
    );
  }

  for (const [group, count] of distractorCounts.entries()) {
    if (count < 4) {
      errors.push(`${setName}: distractor_group "${group}" has only ${count} items (minimum 4 required for 4-choice gameplay)`);
    }
  }

  summaryLines.push(`  TOTAL ${setName}: ${total} items | ${distractorCounts.size} distractor groups (all >= 4 items)`);
}

auditSet("core");
auditSet("comprehensive");

console.log(summaryLines.join("\n"));

if (errors.length > 0) {
  console.error(`\nQUALITY AUDIT FAILED (${errors.length} issues):`);
  for (const e of errors.slice(0, 40)) {
    console.error(`  - ${e}`);
  }
  if (errors.length > 40) {
    console.error(`  ... and ${errors.length - 40} more issues.`);
  }
  process.exit(1);
}

console.log("\nQUALITY AUDIT PASSED: 0 issues across all 18 files.");
