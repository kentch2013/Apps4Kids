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

// 6. Vosk blob: Web Worker CSP allowance (strictly offline) & graceful createModel() fallback
(async () => {
  for (const rel of ["web-poc/index.html", "web-poc/spike-voice/index.html"]) {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(html.includes("default-src 'self'"), `${rel} CSP must lock default-src to 'self'`);
    assert.ok(html.includes("connect-src 'self'"), `${rel} CSP must lock connect-src to 'self'`);
    assert.ok(html.includes("worker-src 'self' blob:"), `${rel} CSP must allow same-origin and blob: workers`);
    assert.ok(
      html.includes("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'"),
      `${rel} CSP must include 'unsafe-eval' for local vosk-browser Emscripten blob: worker`
    );
    assert.ok(
      /vosk-browser/i.test(html) && /WKWebView/i.test(html),
      `${rel} must document the temporary web-PoC vosk-browser CSP exception`
    );
    const externalUrlMatch = html.match(/https?:\/\/[^\s"'`<>]+/i);
    assert.strictEqual(
      externalUrlMatch,
      null,
      `Disallowed external runtime URL in ${rel}: ${externalUrlMatch ? externalUrlMatch[0] : ""}`
    );
  }

  const webPocHtml = fs.readFileSync(path.join(WEB_POC_DIR, "index.html"), "utf8");
  assert.ok(
    webPocHtml.includes('id="calibError"') && webPocHtml.includes('role="alert"'),
    "web-poc/index.html must include #calibError alert banner for Mic Check fallback"
  );

  const whackApp = fs.readFileSync(path.join(WEB_POC_DIR, "games", "whack-a-mole", "app.js"), "utf8");
  assert.ok(
    whackApp.includes("calibError") && whackApp.includes("fallbackReason"),
    "whack-a-mole/app.js must surface recognizer.fallbackReason in #calibError"
  );

  const voskAdapterSrc = fs.readFileSync(path.join(SPIKE_DIR, "vosk-adapter.js"), "utf8");
  assert.ok(
    !voskAdapterSrc.includes('method: "HEAD"'),
    "vosk-adapter.js must not issue a HEAD cache-size probe that triggers net::ERR_ABORTED"
  );

  // Verify createOfflineRecognizer catches Vosk.createModel() rejections and activates dry-run fallback
  delete require.cache[require.resolve(path.join(SPIKE_DIR, "vosk-adapter.js"))];
  const prevVosk = globalThis.Vosk;
  const statuses = [];
  const heard = [];
  try {
    globalThis.Vosk = {
      createModel: async () => {
        throw new EvalError("Simulated CSP EvalError inside blob: worker");
      },
    };
    require(path.join(SPIKE_DIR, "vosk-adapter.js"));
    const adapter = globalThis.Apps4KidsVoskAdapter;
    const rec = await adapter.createOfflineRecognizer({
      grammar: ["red", "two", "blue", "[unk]"],
      onStatus: (msg) => statuses.push(msg),
      onResult: (payload) => heard.push(payload.text),
    });
    assert.strictEqual(rec.mode, "dry-run", "Failed createModel() must fall back to dry-run mode");
    assert.ok(
      typeof rec.fallbackReason === "string" && rec.fallbackReason.includes("Simulated CSP EvalError"),
      "Dry-run fallback must expose fallbackReason"
    );
    assert.ok(
      statuses.some((s) => /Dry-Run/i.test(s) && /Simulated CSP EvalError/.test(s)),
      "onStatus must report the caught createModel() failure and dry-run fallback"
    );
    rec.simulateWord("red");
    assert.deepStrictEqual(heard, ["red"], "Dry-run fallback simulateWord() must emit onResult");
    rec.terminate();
  } finally {
    if (typeof prevVosk === "undefined") {
      delete globalThis.Vosk;
    } else {
      globalThis.Vosk = prevVosk;
    }
  }

  console.log(
    "VOICE HARDENING TESTS PASSED | AudioWorkletNode, reusable 16kHz buffer, Web Audio SFX pre-decode, local HTTPS servers, quiet-window FP counter, CSP worker policy, createModel() fallback, and dev staging helper verified."
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
