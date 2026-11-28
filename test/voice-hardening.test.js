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

  // 7. CSS [hidden] attribute enforcement over dry-run simulator bars (.sim-bar / .dry-run)
  {
    const webPocCss = fs.readFileSync(path.join(WEB_POC_DIR, "styles.css"), "utf8");
    const spikeCss = fs.readFileSync(path.join(SPIKE_DIR, "styles.css"), "utf8");

    assert.ok(
      /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important\s*;/s.test(webPocCss),
      "web-poc/styles.css must enforce [hidden] { display: none !important; }"
    );
    assert.ok(
      /\.sim-bar:not\(\[hidden\]\)\s*\{[^}]*display\s*:\s*flex\s*;/s.test(webPocCss),
      "web-poc/styles.css must scope .sim-bar flex display with :not([hidden])"
    );
    assert.ok(
      !/(^|\n)\s*\.sim-bar\s*\{/m.test(webPocCss),
      "web-poc/styles.css must not define an unscoped .sim-bar rule that overrides [hidden]"
    );

    assert.ok(
      /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important\s*;/s.test(spikeCss),
      "web-poc/spike-voice/styles.css must enforce [hidden] { display: none !important; }"
    );
    assert.ok(
      /\.dry-run:not\(\[hidden\]\)\s*\{[^}]*display\s*:\s*flex\s*;/s.test(spikeCss),
      "web-poc/spike-voice/styles.css must scope .dry-run flex display with :not([hidden])"
    );
    assert.ok(
      !/(^|\n)\s*\.dry-run\s*\{/m.test(spikeCss),
      "web-poc/spike-voice/styles.css must not define an unscoped .dry-run rule that overrides [hidden]"
    );

    for (const [rel, css] of [
      ["web-poc/styles.css", webPocCss],
      ["web-poc/spike-voice/styles.css", spikeCss],
    ]) {
      const externalUrlMatch = css.match(/https?:\/\/[^\s"'`<>)]+/i);
      assert.strictEqual(
        externalUrlMatch,
        null,
        `Disallowed external runtime URL in ${rel}: ${externalUrlMatch ? externalUrlMatch[0] : ""}`
      );
    }

    const pocHtml = fs.readFileSync(path.join(WEB_POC_DIR, "index.html"), "utf8");
    assert.ok(
      /<div[^>]*id="calibDryRunBar"[^>]*class="sim-bar"[^>]*\bhidden\b/i.test(pocHtml),
      "web-poc/index.html must keep #calibDryRunBar hidden on initial load"
    );
    assert.ok(
      /<div[^>]*id="gameDryRunBar"[^>]*class="sim-bar"[^>]*\bhidden\b/i.test(pocHtml),
      "web-poc/index.html must keep #gameDryRunBar hidden on initial load"
    );

    const spikeHtml = fs.readFileSync(path.join(SPIKE_DIR, "index.html"), "utf8");
    assert.ok(
      /<div[^>]*id="dryRunBar"[^>]*class="dry-run"[^>]*\bhidden\b/i.test(spikeHtml),
      "web-poc/spike-voice/index.html must keep #dryRunBar hidden on initial load"
    );
  }

  // 8. Manifest-driven SW precaching, CI-safe optional Vosk caching, prefix-scoped cache cleanup & honest Airplane Mode UI
  {
    const pocSwMod = require(path.join(WEB_POC_DIR, "sw.js"));
    const spikeSwMod = require(path.join(SPIKE_DIR, "sw.js"));

    assert.strictEqual(pocSwMod.CACHE_PREFIX, "apps4kids-webpoc-");
    assert.strictEqual(pocSwMod.CACHE_NAME, "apps4kids-webpoc-v3");
    assert.strictEqual(spikeSwMod.CACHE_PREFIX, "apps4kids-gate0-voice-");
    assert.strictEqual(spikeSwMod.CACHE_NAME, "apps4kids-gate0-voice-v3");
    assert.ok(
      !spikeSwMod.PRECACHE_ASSETS.includes("./"),
      "spike-voice/sw.js must precache ./index.html rather than bare ./ so serve:poc never 404s on directory path"
    );

    const realManifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "assets", "manifest.json"), "utf8")
    );
    const extracted = pocSwMod.extractManifestAssetUrls(realManifest, "../");
    assert.strictEqual(new Set(extracted).size, extracted.length, "Extracted manifest URLs must be deduplicated");
    assert.ok(
      extracted.every((u) => !/^https?:\/\//i.test(u)),
      "Extracted manifest URLs must never include external HTTP(S) URLs"
    );

    for (const sfxFile of ["bop.wav", "pop_up.wav", "duck_down.wav", "round_win.wav"]) {
      assert.ok(
        extracted.includes(`../assets/audio/sfx/${sfxFile}`),
        `Manifest precache list must include SFX ${sfxFile}`
      );
    }
    const promptUrls = extracted.filter((u) => u.startsWith("../assets/audio/prompts/") && u.endsWith(".wav"));
    const svgUrls = extracted.filter((u) => u.startsWith("../assets/visuals/") && u.endsWith(".svg"));
    const itemWavUrls = extracted.filter((u) => u.startsWith("../assets/audio/items/") && u.endsWith(".wav"));
    assert.ok(promptUrls.length >= 5, `Expected >= 5 prompt WAVs, found ${promptUrls.length}`);
    assert.ok(svgUrls.length >= 90, `Expected >= 90 Numbers & Colors SVGs, found ${svgUrls.length}`);
    assert.ok(itemWavUrls.length >= 90, `Expected >= 90 Numbers & Colors item WAVs, found ${itemWavUrls.length}`);

    const filteredExternal = pocSwMod.extractManifestAssetUrls(
      {
        sfx: { bad: { path: "https://evil.example/a.wav" }, good: { path: "assets/audio/sfx/bop.wav" } },
        prompts: {},
        items: {},
      },
      "../"
    );
    assert.deepStrictEqual(
      filteredExternal,
      ["../assets/audio/sfx/bop.wav"],
      "extractManifestAssetUrls must ignore external URLs"
    );

    function createMockCacheStorage(initialKeys) {
      const store = new Map();
      for (const k of initialKeys || []) {
        store.set(k, new Map());
      }
      return {
        store,
        async open(name) {
          if (!store.has(name)) store.set(name, new Map());
          const bucket = store.get(name);
          return {
            async addAll(urls) {
              for (const u of urls) {
                bucket.set(u, { ok: true, status: 200, url: u });
              }
            },
            async put(url, res) {
              bucket.set(url, res);
            },
            async match(url) {
              return bucket.get(url) || undefined;
            },
            async keys() {
              return Array.from(bucket.keys()).map((u) => ({ url: u }));
            },
          };
        },
        async keys() {
          return Array.from(store.keys());
        },
        async delete(name) {
          return store.delete(name);
        },
      };
    }

    function createMockFetch(voskPresent) {
      return async function mockFetch(url) {
        if (url === "../assets/manifest.json") {
          return { ok: true, status: 200, async json() { return realManifest; } };
        }
        if (url.includes("vendor/vosk/")) {
          if (voskPresent) {
            return { ok: true, status: 200, url };
          }
          return { ok: false, status: 404, url };
        }
        return { ok: true, status: 200, url };
      };
    }

    // 8a. web-poc/sw.js CI-safe install (vendor/vosk absent -> 404)
    const ciPocCaches = createMockCacheStorage();
    const ciPocRes = await pocSwMod.precacheAll(ciPocCaches, createMockFetch(false));
    assert.strictEqual(ciPocRes.cacheName, "apps4kids-webpoc-v3");
    assert.strictEqual(ciPocRes.manifestCount, extracted.length);
    assert.strictEqual(ciPocRes.voskCached.length, 0, "Unstaged Vosk files must be skipped gracefully in CI");
    assert.strictEqual(ciPocRes.voskSkipped.length, 2);
    const ciPocBucket = ciPocCaches.store.get("apps4kids-webpoc-v3");
    assert.ok(ciPocBucket.has("../assets/audio/sfx/bop.wav"), "SFX WAV must be cached");
    assert.ok(ciPocBucket.has(svgUrls[0]), "Active item SVG must be cached");
    assert.ok(ciPocBucket.has(itemWavUrls[0]), "Active item WAV must be cached");

    // 8b. web-poc/sw.js staged live install (vendor/vosk present -> 200)
    const stagedPocCaches = createMockCacheStorage();
    const stagedPocRes = await pocSwMod.precacheAll(stagedPocCaches, createMockFetch(true));
    assert.strictEqual(stagedPocRes.voskCached.length, 2, "Staged Vosk assets must be cached when present");
    assert.strictEqual(stagedPocRes.voskSkipped.length, 0);
    const stagedPocBucket = stagedPocCaches.store.get("apps4kids-webpoc-v3");
    assert.ok(stagedPocBucket.has("./spike-voice/vendor/vosk/vosk.js"));
    assert.ok(stagedPocBucket.has("./spike-voice/vendor/vosk/vosk-model-small-en-us-0.15.tar.gz"));

    // 8c. web-poc/spike-voice/sw.js CI-safe & staged install
    const ciSpikeCaches = createMockCacheStorage();
    const ciSpikeRes = await spikeSwMod.precacheAll(ciSpikeCaches, createMockFetch(false));
    assert.strictEqual(ciSpikeRes.voskCached.length, 0);
    assert.strictEqual(ciSpikeRes.voskSkipped.length, 2);

    const stagedSpikeCaches = createMockCacheStorage();
    const stagedSpikeRes = await spikeSwMod.precacheAll(stagedSpikeCaches, createMockFetch(true));
    assert.strictEqual(stagedSpikeRes.voskCached.length, 2);
    assert.strictEqual(stagedSpikeRes.voskSkipped.length, 0);
    const stagedSpikeBucket = stagedSpikeCaches.store.get("apps4kids-gate0-voice-v3");
    assert.ok(stagedSpikeBucket.has("./vendor/vosk/vosk.js"));
    assert.ok(stagedSpikeBucket.has("./vendor/vosk/vosk-model-small-en-us-0.15.tar.gz"));

    // 8d. Prefix-scoped stale cache cleanup on activate (never clobber sibling SW cache)
    const sharedCaches = createMockCacheStorage([
      "apps4kids-webpoc-v1",
      "apps4kids-webpoc-v2",
      "apps4kids-webpoc-v3",
      "apps4kids-gate0-voice-v2",
      "apps4kids-gate0-voice-v3",
    ]);
    const pocDeleted = await pocSwMod.cleanupStaleCaches(sharedCaches);
    assert.deepStrictEqual(pocDeleted.sort(), ["apps4kids-webpoc-v1", "apps4kids-webpoc-v2"]);
    assert.ok(sharedCaches.store.has("apps4kids-webpoc-v3"), "Active web-poc cache must be retained");
    assert.ok(sharedCaches.store.has("apps4kids-gate0-voice-v3"), "Sibling spike-voice cache must not be deleted by web-poc SW");

    const spikeDeleted = await spikeSwMod.cleanupStaleCaches(sharedCaches);
    assert.deepStrictEqual(spikeDeleted, ["apps4kids-gate0-voice-v2"]);
    assert.ok(sharedCaches.store.has("apps4kids-gate0-voice-v3"), "Active spike-voice cache must be retained");
    assert.ok(sharedCaches.store.has("apps4kids-webpoc-v3"), "Sibling web-poc cache must not be deleted by spike-voice SW");

    // 8e. Honest offline-ready status UI in both app.js files
    const pocAppSrc = fs.readFileSync(path.join(WEB_POC_DIR, "games", "whack-a-mole", "app.js"), "utf8");
    assert.ok(pocAppSrc.includes("Caching offline pack..."), "whack-a-mole/app.js must display warming status");
    assert.ok(pocAppSrc.includes("Ready for Airplane Mode"), "whack-a-mole/app.js must display Ready for Airplane Mode once verified");
    assert.ok(pocAppSrc.includes("navigator.serviceWorker.ready"), "whack-a-mole/app.js must await navigator.serviceWorker.ready");
    assert.ok(pocAppSrc.includes("caches.open"), "whack-a-mole/app.js must verify Cache Storage before showing ready");
    assert.ok(!pocAppSrc.includes('"Offline ready"'), "whack-a-mole/app.js must not show premature 'Offline ready' on register()");

    const spikeAppSrc = fs.readFileSync(path.join(SPIKE_DIR, "app.js"), "utf8");
    assert.ok(spikeAppSrc.includes("Caching offline pack..."), "spike-voice/app.js must display warming status");
    assert.ok(spikeAppSrc.includes("Ready for Airplane Mode"), "spike-voice/app.js must display Ready for Airplane Mode once verified");
    assert.ok(spikeAppSrc.includes("navigator.serviceWorker.ready"), "spike-voice/app.js must await navigator.serviceWorker.ready");
    assert.ok(spikeAppSrc.includes("caches.open"), "spike-voice/app.js must verify Cache Storage before showing ready");
    assert.ok(!spikeAppSrc.includes("Service Worker active (offline ready)"), "spike-voice/app.js must not show premature offline ready on register()");
  }

  console.log(
    "VOICE HARDENING TESTS PASSED | AudioWorkletNode, reusable 16kHz buffer, Web Audio SFX pre-decode, local HTTPS servers, quiet-window FP counter, CSP worker policy, createModel() fallback, CSS [hidden] enforcement, manifest-driven SW precaching, and dev staging helper verified."
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
