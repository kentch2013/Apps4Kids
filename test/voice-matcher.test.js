#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const calibration = require(path.join(ROOT, "web-poc", "spike-voice", "calibration.js"));
const voiceMatcher = require(path.join(ROOT, "web-poc", "shared", "voice-matcher.js"));
const evalVoice = require(path.join(ROOT, "scripts", "eval-voice.js"));

// 1. Exports contract
assert.strictEqual(typeof voiceMatcher.createCurriculumMatcher, "function");
assert.strictEqual(typeof voiceMatcher.normalizeTranscript, "function");
assert.strictEqual(typeof voiceMatcher.levenshtein, "function");
assert.strictEqual(typeof voiceMatcher.evaluateVadGate, "function");
assert.strictEqual(typeof evalVoice.evaluateFixtures, "function");
assert.strictEqual(typeof evalVoice.parseWavPcm16, "function");

// 2. Load real vertical-slice curriculum items (Numbers & Colors)
const items = evalVoice.loadVerticalSliceItems(ROOT);
assert.ok(items.length >= 10, "Must load vertical-slice curriculum items");
const matcher = voiceMatcher.createCurriculumMatcher(items);

// 3. Constrained Vosk grammar generation from accepted_utterances
{
  const grammar = matcher.buildConstrainedGrammar(["num-digit-3", "color-red"]);
  assert.ok(grammar.includes("three"), "Grammar must include canonical utterance 'three'");
  assert.ok(grammar.includes("tree"), "Grammar must include alias 'tree'");
  assert.ok(grammar.includes("red"), "Grammar must include 'red'");
  assert.ok(grammar.includes("stop"), "Grammar must include control command 'stop'");
  assert.ok(grammar.includes("repeat"), "Grammar must include control command 'repeat'");
  assert.strictEqual(grammar[grammar.length - 1], "[unk]", "Grammar must end with [unk]");
}

// 4. Exact, synonym, filler-stripping, and self-correction matching
{
  const active = ["num-digit-3", "color-red", "color-gray"];

  const exact = matcher.matchActiveMoles("three", active);
  assert.strictEqual(exact.matched, true);
  assert.strictEqual(exact.matchedId, "num-digit-3");
  assert.strictEqual(exact.matchType, "exact");

  const synonym = matcher.matchActiveMoles("grey", active);
  assert.strictEqual(synonym.matched, true);
  assert.strictEqual(synonym.matchedId, "color-gray");

  const filler = matcher.matchActiveMoles("uhhh, it's RED!", active);
  assert.strictEqual(filler.matched, true);
  assert.strictEqual(filler.matchedId, "color-red");

  const selfCorrect = matcher.matchActiveMoles("red no wait three", active);
  assert.strictEqual(selfCorrect.matched, true);
  assert.strictEqual(selfCorrect.matchedId, "num-digit-3");
}

// 5. Preschool phonetic & bounded fuzzy matching
{
  const active = ["num-digit-3", "color-purple", "color-yellow"];

  const phonetic = matcher.matchActiveMoles("fwee", active);
  assert.strictEqual(phonetic.matched, true);
  assert.strictEqual(phonetic.matchedId, "num-digit-3");
  assert.strictEqual(phonetic.matchType, "phonetic");

  const fuzzy = matcher.matchActiveMoles("purpl", active);
  assert.strictEqual(fuzzy.matched, true);
  assert.strictEqual(fuzzy.matchedId, "color-purple");
  assert.strictEqual(fuzzy.matchType, "fuzzy");
}

// 6. Negative rejections: wrong word, [unk], low confidence, control commands
{
  const active = ["num-digit-1", "color-red"];

  const wrong = matcher.matchActiveMoles("yellow", active);
  assert.strictEqual(wrong.matched, false);
  assert.strictEqual(wrong.matchedId, null);
  assert.strictEqual(wrong.reason, "no_match");

  const unk = matcher.matchActiveMoles("[unk]", active);
  assert.strictEqual(unk.matched, false);
  assert.strictEqual(unk.reason, "unk");

  const lowConf = matcher.matchActiveMoles("red", active, { confidence: 0.2 });
  assert.strictEqual(lowConf.matched, false);
  assert.strictEqual(lowConf.reason, "low_confidence");

  const cmd = matcher.matchActiveMoles("repeat", active);
  assert.strictEqual(cmd.matched, false);
  assert.strictEqual(cmd.command, "repeat");
  assert.strictEqual(cmd.reason, "command");
}

// 7. Ambiguity detection when two active moles share an utterance (oldest mole wins)
{
  const ambiguous = matcher.matchActiveMoles("three", ["num-digit-3", "qty-dice-3"]);
  assert.strictEqual(ambiguous.matched, true);
  assert.strictEqual(ambiguous.matchedId, "num-digit-3");
  assert.strictEqual(ambiguous.ambiguous, true);
  assert.deepStrictEqual(ambiguous.candidateIds, ["num-digit-3", "qty-dice-3"]);
}

// 8. VAD gate rejects quiet ambient noise & passes soft/clean speech
{
  const noisePcm = new Float32Array(3200).fill(0.008); // 200ms at 16 kHz
  const noiseVad = voiceMatcher.evaluateVadGate(noisePcm, 16000, calibration, {
    noiseFloorRms: 0.01,
  });
  assert.strictEqual(noiseVad.speechDetected, false, "Ambient noise below adaptive VAD must be rejected");

  const softSpeech = new Float32Array(3200).fill(0.045);
  const softVad = voiceMatcher.evaluateVadGate(softSpeech, 16000, calibration, {
    noiseFloorRms: 0.008,
  });
  assert.strictEqual(softVad.speechDetected, true, "Soft speech above adaptive VAD must pass");
}

// 9. End-to-end eval harness smoke test against eval/voice-fixtures/fixtures.json
{
  const summary = evalVoice.evaluateFixtures({ rootDir: ROOT });
  assert.strictEqual(summary.passed, true, "eval:voice fixture suite must pass");
  assert.ok(summary.totalFixtures >= 12, "Expected at least 12 fixtures");
  assert.strictEqual(summary.truePositiveRatePct, 100, "Expected 100% TP on deterministic fixtures");
  assert.strictEqual(summary.falsePositiveRatePct, 0, "Expected 0% FP on noise/wrong-word fixtures");
}

console.log(
  "VOICE MATCHER TESTS PASSED | Grammar, normalization, phonetic/fuzzy, confidence/VAD gating, and eval harness verified."
);
