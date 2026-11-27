#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SPIKE_DIR = path.join(ROOT, "web-poc", "spike-voice");
const WEB_POC_DIR = path.join(ROOT, "web-poc");

// 1. AudioWorklet processor exists and registers apps4kids-pcm-capture
{
  const workletPath = path.join(SPIKE_DIR, "pcm-worklet.js");
  assert.ok(fs.existsSync(workletPath), "Missing web-poc/spike-voice/pcm-worklet.js");
  const workletSrc = fs.readFileSync(workletPath, "utf8");
  assert.ok(workletSrc.includes("AudioWorkletProcessor"), "Worklet must extend AudioWorkletProcessor");
  assert.ok(workletSrc.includes("apps4kids-pcm-capture"), "Worklet must register apps4kids-pcm-capture");
}

// 2. Quiet-window false-positive logic in calibration.js
{
  const cal = require(path.join(SPIKE_DIR, "calibration.js"));
  assert.strictEqual(typeof cal.isQuietWindowFalsePositive, "function");
  assert.strictEqual(cal.isQuietWindowFalsePositive(true, 0, 5000, 2000), false, "Active speech is not a quiet-window FP");
  assert.strictEqual(cal.isQuietWindowFalsePositive(false, 0, 5000, 2000), true, "Pre-speech recognition is a quiet-window FP");
  assert.strictEqual(cal.isQuietWindowFalsePositive(false, 4000, 5500, 2000), false, "Within 2000ms after speech end is not a quiet-window FP");
  assert.strictEqual(cal.isQuietWindowFalsePositive(false, 4000, 6001, 2000), true, "More than 2000ms after speech end while silent is a quiet-window FP");
}

// 3. Local HTTPS CLI arg parsing & exports in both servers
{
  const pocServer = require(path.join(ROOT, "scripts", "serve-web-poc.js"));
  const spikeServer = require(path.join(ROOT, "scripts", "serve-voice-spike.js"));

  for (const mod of [pocServer, spikeServer]) {
    assert.strictEqual(typeof mod.parseServerArgs, "function");
    assert.strictEqual(typeof mod.createServerInstance, "function");
    assert.strictEqual(typeof mod.getLanAddresses, "function");

    const httpCfg = mod.parseServerArgs([], {});
    assert.strictEqual(httpCfg.httpsEnabled, false);

    const tlsCfg = mod.parseServerArgs(["--cert", "a.pem", "--key", "b.pem", "--port", "9443"], {});
    assert.strictEqual(tlsCfg.httpsEnabled, true);
    assert.strictEqual(tlsCfg.certPath, "a.pem");
    assert.strictEqual(tlsCfg.keyPath, "b.pem");
    assert.strictEqual(tlsCfg.port, 9443);

    const defaultHttpsCfg = mod.parseServerArgs(["--https"], {});
    assert.strictEqual(defaultHttpsCfg.httpsEnabled, true);
    assert.ok(defaultHttpsCfg.certPath.endsWith("dev-cert.pem"));
    assert.ok(defaultHttpsCfg.keyPath.endsWith("dev-key.pem"));

    assert.throws(() => mod.parseServerArgs(["--cert", "only-cert.pem"], {}), /requires both/);
  }
}

// 4. AudioWorkletNode, reusable buffer, SFX pre-decoding, SW precache & zero external runtime URLs
{
  const spikeApp = fs.readFileSync(path.join(SPIKE_DIR, "app.js"), "utf8");
  assert.ok(spikeApp.includes("AudioWorkletNode"), "spike-voice/app.js must use AudioWorkletNode");
  assert.ok(spikeApp.includes("isQuietWindowFalsePositive"), "spike-voice/app.js must use isQuietWindowFalsePositive");
  assert.ok(spikeApp.includes("reusableBuf16"), "spike-voice/app.js must reuse 16 kHz AudioBuffer");

  const whackApp = fs.readFileSync(path.join(WEB_POC_DIR, "games", "whack-a-mole", "app.js"), "utf8");
  assert.ok(whackApp.includes("AudioWorkletNode"), "whack-a-mole/app.js must use AudioWorkletNode");
  assert.ok(whackApp.includes("decodeAudioData"), "whack-a-mole/app.js must pre-decode SFX into AudioBuffer");
  assert.ok(whackApp.includes("reusableBuf16"), "whack-a-mole/app.js must reuse 16 kHz AudioBuffer");

  const voskAdapter = fs.readFileSync(path.join(SPIKE_DIR, "vosk-adapter.js"), "utf8");
  assert.ok(voskAdapter.includes("tryLoadLocalVoskScript"), "vosk-adapter.js must auto-load local vendor/vosk/vosk.js when staged");

  const spikeSw = fs.readFileSync(path.join(SPIKE_DIR, "sw.js"), "utf8");
  assert.ok(spikeSw.includes("./pcm-worklet.js"), "spike-voice/sw.js must precache pcm-worklet.js");

  const pocSw = fs.readFileSync(path.join(WEB_POC_DIR, "sw.js"), "utf8");
  assert.ok(pocSw.includes("./spike-voice/pcm-worklet.js"), "web-poc/sw.js must precache pcm-worklet.js");

  const runtimeFiles = [
    "web-poc/spike-voice/pcm-worklet.js",
    "web-poc/spike-voice/calibration.js",
    "web-poc/spike-voice/vosk-adapter.js",
    "web-poc/spike-voice/app.js",
    "web-poc/spike-voice/sw.js",
    "web-poc/games/whack-a-mole/app.js",
    "web-poc/sw.js",
  ];
  for (const rel of runtimeFiles) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const externalUrlMatch = text.match(/https?:\/\/[^\s"'`<>]+/i);
    assert.strictEqual(
      externalUrlMatch,
      null,
      `Disallowed external runtime URL in ${rel}: ${externalUrlMatch ? externalUrlMatch[0] : ""}`
    );
  }
}

// 5. Dev-only staging helper & .gitignore hygiene
{
  const stageMod = require(path.join(ROOT, "scripts", "stage-live-test.js"));
  assert.ok(Array.isArray(stageMod.VOSK_ASSETS) && stageMod.VOSK_ASSETS.length === 2);
  for (const asset of stageMod.VOSK_ASSETS) {
    assert.strictEqual(asset.license, "Apache-2.0");
    assert.ok(!/zamia/i.test(asset.url), "Must never reference LGPL zamia model");
  }
  const dryOut = execFileSync(process.execPath, [path.join(ROOT, "scripts", "stage-live-test.js"), "--dry-run"], {
    encoding: "utf8",
  });
  assert.ok(dryOut.includes("STAGE LIVE TEST DRY-RUN:"), "Dry-run must print summary offline");

  const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.ok(gitignore.includes("web-poc/spike-voice/vendor/"), ".gitignore must ignore staged Vosk vendor binaries");
  assert.ok(gitignore.includes(".certs/"), ".gitignore must ignore local dev TLS certs");
}

console.log(
  "VOICE HARDENING TESTS PASSED | AudioWorkletNode, reusable 16kHz buffer, Web Audio SFX pre-decode, local HTTPS servers, quiet-window FP counter, and dev staging helper verified."
);
