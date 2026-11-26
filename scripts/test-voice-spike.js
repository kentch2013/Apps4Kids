#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SPIKE_DIR = path.join(ROOT, "web-poc", "spike-voice");

function requireFile(relPath) {
  const fullPath = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(fullPath), `Missing required file: ${relPath}`);
  return fullPath;
}

const requiredFiles = [
  "web-poc/spike-voice/index.html",
  "web-poc/spike-voice/styles.css",
  "web-poc/spike-voice/sw.js",
  "web-poc/spike-voice/manifest.webmanifest",
  "web-poc/spike-voice/calibration.js",
  "web-poc/spike-voice/resampler.js",
  "web-poc/spike-voice/vocab-matcher.js",
  "web-poc/spike-voice/vosk-adapter.js",
  "web-poc/spike-voice/app.js",
  "scripts/serve-voice-spike.js",
  "docs/GATE0_VOICE_SPIKE.md",
];

for (const rel of requiredFiles) {
  requireFile(rel);
}

const calibration = require(path.join(SPIKE_DIR, "calibration.js"));
const resampler = require(path.join(SPIKE_DIR, "resampler.js"));
const matcher = require(path.join(SPIKE_DIR, "vocab-matcher.js"));

// 1. Calibration Stage A: RMS, dBFS, adaptive VAD threshold, mute & clipping detection
{
  const silent = new Float32Array(1024);
  const silentStats = calibration.analyzeFrame(silent);
  assert.strictEqual(silentStats.rms, 0);
  assert.strictEqual(silentStats.isMuted, true);
  assert.strictEqual(silentStats.isClipped, false);

  const quietRoom = new Float32Array(1024).fill(0.01);
  const stageA = calibration.computeStageAResult([quietRoom, quietRoom]);
  assert.ok(Math.abs(stageA.noiseFloorRms - 0.01) < 1e-6, "Expected RMS ~0.01");
  assert.ok(stageA.noiseFloorDbfs < -35 && stageA.noiseFloorDbfs > -45, "Expected ~-40 dBFS");
  assert.ok(stageA.vadThresholdRms >= 0.02 && stageA.vadThresholdRms <= 0.25, "Adaptive VAD threshold in bounds");
  assert.strictEqual(stageA.status, "ok");

  const clipped = new Float32Array(256).fill(0.99);
  const clippedStats = calibration.analyzeFrame(clipped);
  assert.strictEqual(clippedStats.isClipped, true);
}

// 2. Calibration Stage B: 3 test words ("red", "two", "blue") & latency tracking
{
  assert.deepStrictEqual(calibration.STAGE_B_WORDS, ["red", "two", "blue"]);
  const session = calibration.createStageBSession();
  assert.strictEqual(session.currentWord(), "red");
  assert.strictEqual(session.recordAttempt("red", 210).matched, true);
  assert.strictEqual(session.currentWord(), "two");
  assert.strictEqual(session.recordAttempt("blue", 180).matched, false);
  assert.strictEqual(session.recordAttempt("two", 240).matched, true);
  assert.strictEqual(session.currentWord(), "blue");
  assert.strictEqual(session.recordAttempt("blue", 190).matched, true);
  assert.strictEqual(session.isComplete(), true);
  const summary = session.summary();
  assert.strictEqual(summary.matchedCount, 3);
  assert.strictEqual(summary.totalExpected, 3);
  assert.ok(Math.abs(summary.meanLatencyMs - 213.33) < 1.0);
}

// 3. Resampler: 48 kHz -> 16 kHz linear downsampling & Int16 conversion
{
  const input48k = new Float32Array(4800); // 100ms at 48kHz
  for (let i = 0; i < input48k.length; i++) {
    input48k[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
  }
  const out16k = resampler.downsampleFloat32(input48k, 48000, 16000);
  assert.strictEqual(out16k.length, 1600, "100ms at 16kHz must be 1600 samples");
  const pcm16 = resampler.floatToInt16PCM(out16k);
  assert.strictEqual(pcm16.length, 1600);
  assert.ok(pcm16 instanceof Int16Array);
  let maxAbs = 0;
  for (let i = 0; i < pcm16.length; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(pcm16[i]));
  }
  assert.ok(maxAbs > 10000 && maxAbs < 20000, "Sine amplitude ~0.5 should map near ~16384");
}

// 4. Constrained-vocabulary grammar & matcher
{
  const grammar = matcher.getVoskGrammarList();
  assert.ok(grammar.includes("[unk]"), "Grammar must include [unk] rejection token");
  for (const token of ["one", "ten", "red", "blue", "green", "yellow", "orange", "purple", "stop", "repeat"]) {
    assert.ok(grammar.includes(token), `Grammar missing required token: ${token}`);
  }
  assert.deepStrictEqual(matcher.matchUtterance("Red"), { matched: true, canonical: "red", category: "color" });
  assert.deepStrictEqual(matcher.matchUtterance("2"), { matched: true, canonical: "two", category: "number" });
  assert.deepStrictEqual(matcher.matchUtterance("to"), { matched: true, canonical: "two", category: "number" });
  assert.deepStrictEqual(matcher.matchUtterance("repeat"), { matched: true, canonical: "repeat", category: "command" });
  assert.strictEqual(matcher.matchUtterance("[unk]").matched, false);
  assert.strictEqual(matcher.matchUtterance("elephant").matched, false);
  assert.strictEqual(matcher.matchUtterance("   ").matched, false);
}

// 5. Offline-only & CSP hygiene check on web-poc/spike-voice/
{
  const html = fs.readFileSync(path.join(SPIKE_DIR, "index.html"), "utf8");
  assert.ok(html.includes("Content-Security-Policy"), "index.html must declare a Content-Security-Policy meta tag");
  assert.ok(html.includes("connect-src 'self'"), "CSP must lock connect-src to 'self'");

  const runtimeFiles = [
    "index.html",
    "sw.js",
    "calibration.js",
    "resampler.js",
    "vocab-matcher.js",
    "vosk-adapter.js",
    "app.js",
  ];
  for (const name of runtimeFiles) {
    const text = fs.readFileSync(path.join(SPIKE_DIR, name), "utf8");
    const externalUrlMatch = text.match(/https?:\/\/[^\s"'`<>]+/i);
    assert.strictEqual(
      externalUrlMatch,
      null,
      `Disallowed external runtime URL in ${name}: ${externalUrlMatch ? externalUrlMatch[0] : ""}`
    );
  }

  const sw = fs.readFileSync(path.join(SPIKE_DIR, "sw.js"), "utf8");
  for (const asset of ["./index.html", "./app.js", "./calibration.js", "./resampler.js", "./vocab-matcher.js", "./vosk-adapter.js"]) {
    assert.ok(sw.includes(asset), `Service Worker must precache ${asset}`);
  }
}

// 6. Gate 0 Go/No-Go report contract
{
  const doc = fs.readFileSync(path.join(ROOT, "docs", "GATE0_VOICE_SPIKE.md"), "utf8");
  for (const token of ["Airplane Mode", "iPhone Safari", "Go/No-Go", "vosk-model-small-en-us-0.15", "Apache-2.0", "Capacitor"]) {
    assert.ok(doc.includes(token), `docs/GATE0_VOICE_SPIKE.md missing required section/token: ${token}`);
  }
}

console.log("GATE 0 VOICE SPIKE TESTS PASSED | Calibration, resampler, constrained grammar, offline CSP/SW, and report verified.");
