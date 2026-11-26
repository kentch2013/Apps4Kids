#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const calibration = require(path.join(ROOT, "web-poc", "spike-voice", "calibration.js"));
const resampler = require(path.join(ROOT, "web-poc", "spike-voice", "resampler.js"));
const voiceMatcher = require(path.join(ROOT, "web-poc", "shared", "voice-matcher.js"));

const VALID_CATEGORIES = new Set([
  "clean_hit",
  "soft_voice",
  "synonym",
  "wrong_word",
  "ambient_noise",
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  minTruePositiveRatePct: 90,
  maxFalsePositiveRatePct: 5,
  maxP95LatencyMs: 250,
});

function parseWavPcm16(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error("WAV file is shorter than 44 bytes");
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid RIFF/WAVE header");
  }
  let offset = 12;
  let fmt = null;
  let dataBuf = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(buffer.length, start + size);
    if (id === "fmt " && size >= 16) {
      fmt = {
        audioFormat: buffer.readUInt16LE(start),
        numChannels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      dataBuf = buffer.subarray(start, end);
    }
    offset = start + size + (size % 2);
  }
  if (!fmt || !dataBuf) {
    throw new Error("Missing fmt or data chunk in WAV");
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`Expected 16-bit PCM WAV (got format=${fmt.audioFormat}, bits=${fmt.bitsPerSample})`);
  }
  if (fmt.numChannels !== 1) {
    throw new Error(`Expected mono WAV (got channels=${fmt.numChannels})`);
  }
  const sampleCount = Math.floor(dataBuf.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = dataBuf.readInt16LE(i * 2) / 32768;
  }
  return {
    sampleRate: fmt.sampleRate,
    numChannels: fmt.numChannels,
    bitsPerSample: fmt.bitsPerSample,
    samples,
  };
}

function loadVerticalSliceItems(rootDir) {
  const base = rootDir || ROOT;
  const files = [
    path.join(base, "preschool-curriculum", "core", "02_numbers_quantities.json"),
    path.join(base, "preschool-curriculum", "core", "05_colors_measurement.json"),
  ];
  const items = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    if (Array.isArray(data.items)) {
      for (const item of data.items) items.push(item);
    }
  }
  return items;
}

function percentile(sortedValues, p) {
  if (!sortedValues || sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[idx];
}

function evaluateFixtures(options) {
  const opts = options || {};
  const rootDir = opts.rootDir || ROOT;
  const manifestPath =
    opts.manifestPath || path.join(rootDir, "eval", "voice-fixtures", "fixtures.json");
  const thresholds = Object.assign({}, DEFAULT_THRESHOLDS, opts.thresholds || {});

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest || !Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new Error("fixtures.json must contain a non-empty fixtures array");
  }

  const items = loadVerticalSliceItems(rootDir);
  const matcher = voiceMatcher.createCurriculumMatcher(items);

  const results = [];
  const failures = [];
  const latenciesMs = [];
  const byCategory = {};

  let positiveTotal = 0;
  let truePositives = 0;
  let negativeTotal = 0;
  let falsePositives = 0;

  for (const fx of manifest.fixtures) {
    if (!VALID_CATEGORIES.has(fx.category)) {
      throw new Error(`Invalid fixture category "${fx.category}" in fixture "${fx.id}"`);
    }
    if (!Array.isArray(fx.active_mole_ids) || fx.active_mole_ids.length === 0) {
      throw new Error(`Fixture "${fx.id}" must declare non-empty active_mole_ids`);
    }
    if (!byCategory[fx.category]) {
      byCategory[fx.category] = { total: 0, passed: 0, failed: 0 };
    }
    byCategory[fx.category].total++;

    const wavFullPath = path.join(rootDir, fx.wav_path);
    if (!fs.existsSync(wavFullPath)) {
      throw new Error(`Missing WAV fixture file: ${fx.wav_path}`);
    }

    const t0 = process.hrtime.bigint();
    const parsed = parseWavPcm16(fs.readFileSync(wavFullPath));
    const pcm16k =
      parsed.sampleRate === 16000
        ? parsed.samples
        : resampler.downsampleFloat32(parsed.samples, parsed.sampleRate, 16000);

    const vad = voiceMatcher.evaluateVadGate(pcm16k, 16000, calibration, {
      noiseFloorRms: typeof fx.noise_floor_rms === "number" ? fx.noise_floor_rms : 0.008,
    });

    let matchResult;
    if (!vad.speechDetected) {
      matchResult = {
        matched: false,
        matchedId: null,
        matchedUtterance: null,
        matchType: null,
        command: null,
        ambiguous: false,
        candidateIds: [],
        confidence: fx.simulated_confidence,
        reason: "vad_rejected",
      };
    } else {
      matchResult = matcher.matchActiveMoles(fx.simulated_transcript, fx.active_mole_ids, {
        confidence: typeof fx.simulated_confidence === "number" ? fx.simulated_confidence : 1.0,
      });
    }

    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    latenciesMs.push(elapsedMs);

    const actualId = matchResult.matched ? matchResult.matchedId : null;
    const expectedId = fx.expected_match_id === undefined ? null : fx.expected_match_id;
    const passed = actualId === expectedId;

    if (expectedId !== null) {
      positiveTotal++;
      if (passed) truePositives++;
    } else {
      negativeTotal++;
      if (actualId !== null) falsePositives++;
    }

    if (passed) {
      byCategory[fx.category].passed++;
    } else {
      byCategory[fx.category].failed++;
      failures.push({
        id: fx.id,
        category: fx.category,
        expected_match_id: expectedId,
        actual_match_id: actualId,
        reason: matchResult.reason,
        vad_speech_detected: vad.speechDetected,
        max_frame_rms: Number(vad.maxFrameRms.toFixed(5)),
        vad_threshold_rms: Number(vad.vadThresholdRms.toFixed(5)),
      });
    }

    results.push({
      id: fx.id,
      category: fx.category,
      expected_match_id: expectedId,
      actual_match_id: actualId,
      passed,
      match_type: matchResult.matchType,
      reason: matchResult.reason,
      vad_speech_detected: vad.speechDetected,
      latency_ms: Number(elapsedMs.toFixed(3)),
    });
  }

  const sortedLatencies = latenciesMs.slice().sort((a, b) => a - b);
  const avgLatencyMs =
    latenciesMs.length > 0
      ? latenciesMs.reduce((acc, v) => acc + v, 0) / latenciesMs.length
      : 0;
  const p95LatencyMs = percentile(sortedLatencies, 95);

  const truePositiveRatePct = positiveTotal > 0 ? (truePositives / positiveTotal) * 100 : 100;
  const falsePositiveRatePct = negativeTotal > 0 ? (falsePositives / negativeTotal) * 100 : 0;

  const passed =
    failures.length === 0 &&
    truePositiveRatePct >= thresholds.minTruePositiveRatePct &&
    falsePositiveRatePct <= thresholds.maxFalsePositiveRatePct &&
    p95LatencyMs <= thresholds.maxP95LatencyMs;

  return {
    passed,
    totalFixtures: results.length,
    positiveTotal,
    truePositives,
    truePositiveRatePct: Number(truePositiveRatePct.toFixed(2)),
    negativeTotal,
    falsePositives,
    falsePositiveRatePct: Number(falsePositiveRatePct.toFixed(2)),
    avgLatencyMs: Number(avgLatencyMs.toFixed(3)),
    p95LatencyMs: Number(p95LatencyMs.toFixed(3)),
    byCategory,
    failures,
    results,
  };
}

function main() {
  const jsonMode = process.argv.includes("--json");
  const summary = evaluateFixtures();

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const status = summary.passed ? "VOICE EVAL PASSED" : "VOICE EVAL FAILED";
    console.log(
      `${status} | fixtures=${summary.totalFixtures} | TP=${summary.truePositives}/${summary.positiveTotal} (${summary.truePositiveRatePct}%) | FP=${summary.falsePositives}/${summary.negativeTotal} (${summary.falsePositiveRatePct}%) | latency avg=${summary.avgLatencyMs}ms p95=${summary.p95LatencyMs}ms`
    );
    for (const [cat, stats] of Object.entries(summary.byCategory)) {
      console.log(`  - ${cat}: ${stats.passed}/${stats.total} passed`);
    }
    if (summary.failures.length > 0) {
      console.error("Per-fixture failures:");
      for (const fail of summary.failures) {
        console.error(
          `  * ${fail.id} [${fail.category}]: expected=${fail.expected_match_id}, actual=${fail.actual_match_id}, reason=${fail.reason}, vad=${fail.vad_speech_detected}`
        );
      }
    }
  }

  process.exit(summary.passed ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  VALID_CATEGORIES,
  DEFAULT_THRESHOLDS,
  parseWavPcm16,
  loadVerticalSliceItems,
  evaluateFixtures,
};
