#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "eval", "voice-fixtures");
const WAV_DIR = path.join(FIXTURES_DIR, "wav");
const ASSETS_AUDIO_DIR = path.join(ROOT, "assets", "audio", "items");

const TARGET_SAMPLE_RATE = 16000;

function parseWavPcm16(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error("Invalid WAV buffer: too short");
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV header: missing RIFF/WAVE");
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
    throw new Error("Invalid WAV: missing fmt or data chunk");
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error("Unsupported WAV format: expected 16-bit PCM");
  }
  const frameCount = Math.floor(dataBuf.length / (2 * fmt.numChannels));
  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let ch = 0; ch < fmt.numChannels; ch++) {
      sum += dataBuf.readInt16LE((i * fmt.numChannels + ch) * 2) / 32768;
    }
    samples[i] = sum / fmt.numChannels;
  }
  return { sampleRate: fmt.sampleRate, numChannels: fmt.numChannels, samples };
}

function encodeWavPcm16Mono(samples, sampleRate) {
  const sr = sampleRate || TARGET_SAMPLE_RATE;
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    buf.writeInt16LE(int16, 44 + i * 2);
  }
  return buf;
}

function computePeakWindowRms(samples, windowSize) {
  let maxRms = 0;
  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    let sumSq = 0;
    for (let j = 0; j < windowSize; j++) {
      const v = samples[i + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    if (rms > maxRms) maxRms = rms;
  }
  return maxRms;
}

function scaleSamplesToTargetRms(samples, targetPeakRms) {
  const out = new Float32Array(samples.length);
  const current = computePeakWindowRms(samples, 320); // 20ms at 16 kHz
  if (current <= 1e-6) return out;
  const gain = targetPeakRms / current;
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain;
    const absV = v < 0 ? -v : v;
    if (absV > maxAbs) maxAbs = absV;
    out[i] = v;
  }
  if (maxAbs > 0.9) {
    const limiter = 0.9 / maxAbs;
    for (let i = 0; i < out.length; i++) out[i] *= limiter;
  }
  return out;
}

function generateSyntheticSpeechEnvelope(durationSec, freqHz, targetRms) {
  const len = Math.floor(TARGET_SAMPLE_RATE * durationSec);
  const out = new Float32Array(len);
  const start = Math.floor(len * 0.15);
  const end = Math.floor(len * 0.85);
  for (let i = start; i < end; i++) {
    const t = i / TARGET_SAMPLE_RATE;
    const env = Math.sin(Math.PI * ((i - start) / (end - start)));
    const wave =
      0.65 * Math.sin(2 * Math.PI * freqHz * t) +
      0.25 * Math.sin(2 * Math.PI * freqHz * 2.02 * t) +
      0.1 * Math.sin(2 * Math.PI * freqHz * 3.01 * t);
    out[i] = wave * env;
  }
  return scaleSamplesToTargetRms(out, targetRms);
}

function generateDeterministicNoise(durationSec, targetRms, seed) {
  const len = Math.floor(TARGET_SAMPLE_RATE * durationSec);
  const out = new Float32Array(len);
  if (targetRms <= 0) return out;
  let state = (seed >>> 0) || 123456789;
  for (let i = 0; i < len; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return scaleSamplesToTargetRms(out, targetRms);
}

function loadOrSynthesizeSpeech(assetRelPath, fallbackFreq, targetRms) {
  if (assetRelPath) {
    const full = path.join(ASSETS_AUDIO_DIR, assetRelPath);
    if (fs.existsSync(full)) {
      const parsed = parseWavPcm16(fs.readFileSync(full));
      if (parsed.sampleRate === TARGET_SAMPLE_RATE && parsed.samples.length >= 640) {
        return scaleSamplesToTargetRms(parsed.samples, targetRms);
      }
    }
  }
  return generateSyntheticSpeechEnvelope(0.55, fallbackFreq, targetRms);
}

const FIXTURE_SPECS = [
  // Clean hits (5)
  {
    id: "clean-num-3",
    category: "clean_hit",
    asset: "02_numbers_quantities/num-digit-3.wav",
    freq: 280,
    targetRms: 0.18,
    active_mole_ids: ["num-digit-1", "num-digit-3", "color-blue"],
    expected_match_id: "num-digit-3",
    simulated_transcript: "three",
    simulated_confidence: 0.94,
    noise_floor_rms: 0.008,
  },
  {
    id: "clean-num-7",
    category: "clean_hit",
    asset: "02_numbers_quantities/num-digit-7.wav",
    freq: 310,
    targetRms: 0.18,
    active_mole_ids: ["num-digit-2", "num-digit-7", "num-digit-9"],
    expected_match_id: "num-digit-7",
    simulated_transcript: "seven",
    simulated_confidence: 0.92,
    noise_floor_rms: 0.008,
  },
  {
    id: "clean-color-red",
    category: "clean_hit",
    asset: "05_colors_measurement/color-red.wav",
    freq: 260,
    targetRms: 0.18,
    active_mole_ids: ["color-red", "color-green", "color-yellow"],
    expected_match_id: "color-red",
    simulated_transcript: "red",
    simulated_confidence: 0.95,
    noise_floor_rms: 0.008,
  },
  {
    id: "clean-color-blue-self-correct",
    category: "clean_hit",
    asset: "05_colors_measurement/color-blue.wav",
    freq: 300,
    targetRms: 0.18,
    active_mole_ids: ["color-orange", "color-blue", "num-digit-4"],
    expected_match_id: "color-blue",
    simulated_transcript: "um blue",
    simulated_confidence: 0.89,
    noise_floor_rms: 0.008,
  },
  {
    id: "clean-num-10",
    category: "clean_hit",
    asset: "02_numbers_quantities/num-digit-10.wav",
    freq: 330,
    targetRms: 0.18,
    active_mole_ids: ["num-digit-5", "num-digit-10", "color-purple"],
    expected_match_id: "num-digit-10",
    simulated_transcript: "ten",
    simulated_confidence: 0.91,
    noise_floor_rms: 0.008,
  },

  // Soft preschooler voices (3)
  {
    id: "soft-color-yellow",
    category: "soft_voice",
    asset: "05_colors_measurement/color-yellow.wav",
    freq: 340,
    targetRms: 0.045,
    active_mole_ids: ["color-yellow", "color-red", "num-digit-2"],
    expected_match_id: "color-yellow",
    simulated_transcript: "yellow",
    simulated_confidence: 0.72,
    noise_floor_rms: 0.008,
  },
  {
    id: "soft-num-4-phonetic",
    category: "soft_voice",
    asset: "02_numbers_quantities/num-digit-4.wav",
    freq: 295,
    targetRms: 0.045,
    active_mole_ids: ["num-digit-4", "num-digit-8", "color-green"],
    expected_match_id: "num-digit-4",
    simulated_transcript: "fow",
    simulated_confidence: 0.68,
    noise_floor_rms: 0.008,
  },
  {
    id: "soft-color-purple-fuzzy",
    category: "soft_voice",
    asset: "05_colors_measurement/color-purple.wav",
    freq: 355,
    targetRms: 0.045,
    active_mole_ids: ["color-purple", "color-blue", "num-digit-1"],
    expected_match_id: "color-purple",
    simulated_transcript: "puwple",
    simulated_confidence: 0.66,
    noise_floor_rms: 0.008,
  },

  // Synonyms & homophones (3)
  {
    id: "synonym-color-grey",
    category: "synonym",
    asset: "05_colors_measurement/color-gray.wav",
    freq: 270,
    targetRms: 0.16,
    active_mole_ids: ["color-gray", "color-red", "color-blue"],
    expected_match_id: "color-gray",
    simulated_transcript: "grey",
    simulated_confidence: 0.88,
    noise_floor_rms: 0.008,
  },
  {
    id: "synonym-num-2-too",
    category: "synonym",
    asset: "02_numbers_quantities/num-digit-2.wav",
    freq: 290,
    targetRms: 0.16,
    active_mole_ids: ["num-digit-2", "num-digit-6", "color-orange"],
    expected_match_id: "num-digit-2",
    simulated_transcript: "too",
    simulated_confidence: 0.85,
    noise_floor_rms: 0.008,
  },
  {
    id: "synonym-num-3-fwee",
    category: "synonym",
    asset: "02_numbers_quantities/num-digit-3.wav",
    freq: 285,
    targetRms: 0.16,
    active_mole_ids: ["num-digit-3", "num-digit-5", "color-green"],
    expected_match_id: "num-digit-3",
    simulated_transcript: "fwee",
    simulated_confidence: 0.81,
    noise_floor_rms: 0.008,
  },

  // Wrong words / out-of-set utterances (2)
  {
    id: "wrong-word-not-active",
    category: "wrong_word",
    asset: "05_colors_measurement/color-yellow.wav",
    freq: 320,
    targetRms: 0.18,
    active_mole_ids: ["color-red", "color-blue", "num-digit-3"],
    expected_match_id: null,
    simulated_transcript: "yellow",
    simulated_confidence: 0.91,
    noise_floor_rms: 0.008,
  },
  {
    id: "wrong-word-unk",
    category: "wrong_word",
    asset: "02_numbers_quantities/num-digit-5.wav",
    freq: 250,
    targetRms: 0.18,
    active_mole_ids: ["num-digit-1", "num-digit-2", "color-red"],
    expected_match_id: null,
    simulated_transcript: "[unk]",
    simulated_confidence: 0.77,
    noise_floor_rms: 0.008,
  },

  // Ambient noise / silence (2)
  {
    id: "ambient-room-noise",
    category: "ambient_noise",
    noiseSeed: 424242,
    targetRms: 0.009,
    active_mole_ids: ["num-digit-1", "color-red", "color-blue"],
    expected_match_id: null,
    simulated_transcript: "red",
    simulated_confidence: 0.82,
    noise_floor_rms: 0.01,
  },
  {
    id: "ambient-silence",
    category: "ambient_noise",
    noiseSeed: 999999,
    targetRms: 0.0,
    active_mole_ids: ["num-digit-3", "color-green", "color-yellow"],
    expected_match_id: null,
    simulated_transcript: "three",
    simulated_confidence: 0.75,
    noise_floor_rms: 0.008,
  },
];

function run() {
  fs.mkdirSync(WAV_DIR, { recursive: true });
  const fixtures = [];

  for (const spec of FIXTURE_SPECS) {
    const samples =
      spec.category === "ambient_noise"
        ? generateDeterministicNoise(0.5, spec.targetRms, spec.noiseSeed)
        : loadOrSynthesizeSpeech(spec.asset, spec.freq, spec.targetRms);

    const wavRelPath = `eval/voice-fixtures/wav/${spec.id}.wav`;
    const wavFullPath = path.join(ROOT, wavRelPath);
    fs.writeFileSync(wavFullPath, encodeWavPcm16Mono(samples, TARGET_SAMPLE_RATE));

    fixtures.push({
      id: spec.id,
      wav_path: wavRelPath,
      category: spec.category,
      active_mole_ids: spec.active_mole_ids,
      expected_match_id: spec.expected_match_id,
      simulated_transcript: spec.simulated_transcript,
      simulated_confidence: spec.simulated_confidence,
      noise_floor_rms: spec.noise_floor_rms,
    });
  }

  const manifest = {
    schema_version: 1,
    sample_rate_hz: TARGET_SAMPLE_RATE,
    channels: 1,
    bits_per_sample: 16,
    fixtures,
  };

  fs.writeFileSync(
    path.join(FIXTURES_DIR, "fixtures.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );

  console.log(`GENERATED VOICE FIXTURES | count=${fixtures.length}, dir=eval/voice-fixtures/`);
}

if (require.main === module) {
  run();
}

module.exports = { run, parseWavPcm16, encodeWavPcm16Mono };
