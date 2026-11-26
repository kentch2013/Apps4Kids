#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CURRICULUM_DIR = path.join(ROOT, "preschool-curriculum");

const validator = require(path.join(ROOT, "scripts", "validate-curriculum.js"));

// 1. Validator exports contract
assert.strictEqual(typeof validator.validateItemVoiceFields, "function", "validateItemVoiceFields must be exported");
assert.strictEqual(typeof validator.validateCurriculum, "function", "validateCurriculum must be exported");
assert.ok(validator.VALID_VOICE_RECALL_MODES instanceof Set, "VALID_VOICE_RECALL_MODES Set must be exported");
for (const mode of ["direct_word", "synonym_set", "confusable_phoneme", "guided_only"]) {
  assert.ok(validator.VALID_VOICE_RECALL_MODES.has(mode), `Missing voice_recall_mode: ${mode}`);
}

// 2. Schema contract (preschool-curriculum/schema.json)
{
  const schemaPath = path.join(CURRICULUM_DIR, "schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const itemProps =
    (schema.properties &&
      schema.properties.items &&
      schema.properties.items.items &&
      schema.properties.items.items.properties) ||
    (schema.$defs && schema.$defs.curriculumItem && schema.$defs.curriculumItem.properties) ||
    (schema.definitions && schema.definitions.curriculumItem && schema.definitions.curriculumItem.properties);

  assert.ok(itemProps, "schema.json must define item properties");
  assert.ok(itemProps.accepted_utterances, "schema.json must define accepted_utterances");
  assert.strictEqual(itemProps.accepted_utterances.type, "array");
  assert.ok(itemProps.voice_recall_mode, "schema.json must define voice_recall_mode");
  assert.deepStrictEqual(
    itemProps.voice_recall_mode.enum,
    ["direct_word", "synonym_set", "confusable_phoneme", "guided_only"]
  );
  assert.ok(itemProps.confusable_with, "schema.json must define confusable_with");
  assert.strictEqual(itemProps.confusable_with.type, "array");
}

// 3. Unit tests for validateItemVoiceFields (positive & negative cases)
{
  const knownIds = new Set(["num-3", "num-5", "num-9", "col-red", "col-gray"]);

  // Valid direct_word item
  assert.deepStrictEqual(
    validator.validateItemVoiceFields(
      {
        id: "num-3",
        voice_recall_mode: "direct_word",
        accepted_utterances: ["three", "3", "tree"],
        confusable_with: ["num-5"],
      },
      knownIds,
      "test:valid-direct",
      { requireVoiceFields: true }
    ),
    []
  );

  // Valid synonym_set item
  assert.deepStrictEqual(
    validator.validateItemVoiceFields(
      {
        id: "col-gray",
        voice_recall_mode: "synonym_set",
        accepted_utterances: ["gray", "grey"],
      },
      knownIds,
      "test:valid-synonym",
      { requireVoiceFields: true }
    ),
    []
  );

  // Valid guided_only item with empty accepted_utterances
  assert.deepStrictEqual(
    validator.validateItemVoiceFields(
      {
        id: "col-red",
        voice_recall_mode: "guided_only",
        accepted_utterances: [],
      },
      knownIds,
      "test:valid-guided",
      { requireVoiceFields: true }
    ),
    []
  );

  // Reject missing required voice fields when requireVoiceFields is true
  const missingErrs = validator.validateItemVoiceFields(
    { id: "num-3" },
    knownIds,
    "test:missing-required",
    { requireVoiceFields: true }
  );
  assert.ok(missingErrs.length >= 2, "Expected errors for missing required voice fields");

  // Reject empty accepted_utterances on voice-enabled mode
  const emptyUttErrs = validator.validateItemVoiceFields(
    {
      id: "num-3",
      voice_recall_mode: "direct_word",
      accepted_utterances: [],
    },
    knownIds,
    "test:empty-utterances",
    { requireVoiceFields: true }
  );
  assert.ok(emptyUttErrs.length > 0, "Voice-enabled item with empty accepted_utterances must fail");

  // Reject uppercase and punctuation in accepted_utterances
  const badFormatErrs = validator.validateItemVoiceFields(
    {
      id: "col-red",
      voice_recall_mode: "direct_word",
      accepted_utterances: ["Red", "red!", "three o'clock", " red"],
    },
    knownIds,
    "test:bad-format",
    { requireVoiceFields: true }
  );
  assert.ok(badFormatErrs.length >= 4, "Uppercase, punctuation, and unstripped whitespace must fail");

  // Reject duplicate utterances
  const dupUttErrs = validator.validateItemVoiceFields(
    {
      id: "col-red",
      voice_recall_mode: "direct_word",
      accepted_utterances: ["red", "red"],
    },
    knownIds,
    "test:dup-utterances",
    { requireVoiceFields: true }
  );
  assert.ok(dupUttErrs.length > 0, "Duplicate accepted_utterances must fail");

  // Reject invalid voice_recall_mode enum
  const badModeErrs = validator.validateItemVoiceFields(
    {
      id: "col-red",
      voice_recall_mode: "open_dictation",
      accepted_utterances: ["red"],
    },
    knownIds,
    "test:bad-mode",
    { requireVoiceFields: true }
  );
  assert.ok(badModeErrs.length > 0, "Invalid voice_recall_mode must fail");

  // Reject dangling confusable_with reference
  const danglingErrs = validator.validateItemVoiceFields(
    {
      id: "num-5",
      voice_recall_mode: "direct_word",
      accepted_utterances: ["five", "5"],
      confusable_with: ["does-not-exist-99"],
    },
    knownIds,
    "test:dangling-ref",
    { requireVoiceFields: true }
  );
  assert.ok(danglingErrs.length > 0, "Dangling confusable_with ID must fail");

  // Reject self-reference in confusable_with
  const selfRefErrs = validator.validateItemVoiceFields(
    {
      id: "num-5",
      voice_recall_mode: "direct_word",
      accepted_utterances: ["five", "5"],
      confusable_with: ["num-5"],
    },
    knownIds,
    "test:self-ref",
    { requireVoiceFields: true }
  );
  assert.ok(selfRefErrs.length > 0, "Self-referential confusable_with ID must fail");

  // Reject duplicate IDs in confusable_with
  const dupConfErrs = validator.validateItemVoiceFields(
    {
      id: "num-5",
      voice_recall_mode: "direct_word",
      accepted_utterances: ["five", "5"],
      confusable_with: ["num-9", "num-9"],
    },
    knownIds,
    "test:dup-confusable",
    { requireVoiceFields: true }
  );
  assert.ok(dupConfErrs.length > 0, "Duplicate confusable_with IDs must fail");
}

// 4. Real dataset checks for Numbers & Colors vertical slice
{
  const result = validator.validateCurriculum(CURRICULUM_DIR);
  assert.strictEqual(result.errors.length, 0, `Curriculum validation failed: ${result.errors.join("; ")}`);

  const coreNumbers = JSON.parse(
    fs.readFileSync(path.join(CURRICULUM_DIR, "core", "02_numbers_quantities.json"), "utf8")
  );
  const coreColors = JSON.parse(
    fs.readFileSync(path.join(CURRICULUM_DIR, "core", "05_colors_measurement.json"), "utf8")
  );
  const compNumbers = JSON.parse(
    fs.readFileSync(path.join(CURRICULUM_DIR, "comprehensive", "02_numbers_quantities.json"), "utf8")
  );
  const compColors = JSON.parse(
    fs.readFileSync(path.join(CURRICULUM_DIR, "comprehensive", "05_colors_measurement.json"), "utf8")
  );

  // Every item in the Numbers & Colors core vertical slice has voice metadata
  for (const item of [...coreNumbers.items, ...coreColors.items]) {
    assert.ok(
      validator.VALID_VOICE_RECALL_MODES.has(item.voice_recall_mode),
      `Missing valid voice_recall_mode on ${item.id}`
    );
    assert.ok(Array.isArray(item.accepted_utterances), `Missing accepted_utterances array on ${item.id}`);
    if (item.voice_recall_mode !== "guided_only") {
      assert.ok(item.accepted_utterances.length > 0, `Voice-enabled item ${item.id} must have utterances`);
    }
  }

  // Verify alignment with Gate 0 vocab-matcher.js aliases for numbers 1-10 and 6 core colors
  const allNumberUtterances = new Set(coreNumbers.items.flatMap((it) => it.accepted_utterances || []));
  for (const expected of ["one", "won", "two", "to", "too", "three", "tree", "four", "for", "five", "six", "sicks", "seven", "eight", "ate", "nine", "ten"]) {
    assert.ok(allNumberUtterances.has(expected), `core/02_numbers_quantities.json missing Gate 0 utterance: ${expected}`);
  }

  const allColorUtterances = new Set(coreColors.items.flatMap((it) => it.accepted_utterances || []));
  for (const expected of ["red", "read", "blue", "blew", "green", "yellow", "orange", "purple", "gray", "grey"]) {
    assert.ok(allColorUtterances.has(expected), `core/05_colors_measurement.json missing expected color utterance: ${expected}`);
  }

  // Verify confusable_with links exist in core/02_numbers_quantities.json
  const numbersWithConfusables = coreNumbers.items.filter(
    (it) => Array.isArray(it.confusable_with) && it.confusable_with.length > 0
  );
  assert.ok(numbersWithConfusables.length >= 10, "Expected confusable_with links across numbers/quantities items");

  // Verify Core -> Comprehensive voice metadata parity for vertical slice
  const compById = new Map([...compNumbers.items, ...compColors.items].map((it) => [it.id, it]));
  for (const coreItem of [...coreNumbers.items, ...coreColors.items]) {
    const compItem = compById.get(coreItem.id);
    assert.ok(compItem, `Missing comprehensive item for ${coreItem.id}`);
    assert.strictEqual(compItem.voice_recall_mode, coreItem.voice_recall_mode, `voice_recall_mode mismatch on ${coreItem.id}`);
    assert.deepStrictEqual(compItem.accepted_utterances, coreItem.accepted_utterances, `accepted_utterances mismatch on ${coreItem.id}`);
    assert.deepStrictEqual(compItem.confusable_with || [], coreItem.confusable_with || [], `confusable_with mismatch on ${coreItem.id}`);
  }
}

console.log("CURRICULUM VOICE SCHEMA TESTS PASSED | Schema, negative/positive validator rules, Gate 0 aliases, and vertical-slice parity verified.");
