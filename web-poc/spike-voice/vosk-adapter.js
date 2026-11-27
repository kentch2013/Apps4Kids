(function (root) {
  "use strict";

  const TARGET_SAMPLE_RATE = 16000;
  const DEFAULT_MODEL_URL = "./vendor/vosk/vosk-model-small-en-us-0.15.tar.gz";
  const DEFAULT_SCRIPT_URL = "./vendor/vosk/vosk.js";

  function tryLoadLocalVoskScript(scriptUrl) {
    if (typeof root.Vosk !== "undefined" && typeof root.Vosk.createModel === "function") {
      return Promise.resolve(true);
    }
    if (typeof document === "undefined" || !document.head) {
      return Promise.resolve(false);
    }
    const url = scriptUrl || DEFAULT_SCRIPT_URL;
    if (/^https?:\/\//i.test(url)) {
      return Promise.resolve(false);
    }
    const existing = document.querySelector('script[data-apps4kids-vosk="' + url + '"]');
    if (existing) {
      return Promise.resolve(typeof root.Vosk !== "undefined" && typeof root.Vosk.createModel === "function");
    }
    return new Promise(function (resolve) {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.setAttribute("data-apps4kids-vosk", url);
      script.onload = function () {
        resolve(typeof root.Vosk !== "undefined" && typeof root.Vosk.createModel === "function");
      };
      script.onerror = function () {
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }

  async function createOfflineRecognizer(options) {
    const opts = options || {};
    const grammar = opts.grammar || [];
    const modelUrl = opts.modelUrl || DEFAULT_MODEL_URL;
    const scriptUrl = opts.scriptUrl || modelUrl.replace(/[^/]+$/, "vosk.js");
    const onResult = opts.onResult || function () {};
    const onStatus = opts.onStatus || function () {};

    const startTime = performance.now();

    await tryLoadLocalVoskScript(scriptUrl);

    function buildDryRunRecognizer(fallbackReason) {
      const fallback = {
        mode: "dry-run",
        loadTimeMs: Math.round(performance.now() - startTime),
        modelBytes: 0,
        acceptWaveform() {},
        simulateWord(word) {
          onResult({ text: word, timestampMs: performance.now() });
        },
        terminate() {},
      };
      if (fallbackReason) {
        fallback.fallbackReason = fallbackReason;
      }
      return fallback;
    }

    if (typeof root.Vosk === "undefined" || typeof root.Vosk.createModel !== "function") {
      onStatus("Local Vosk WASM runtime not staged in ./vendor/vosk/ — running in Dry-Run/Calibration-Only mode.");
      return buildDryRunRecognizer("");
    }

    onStatus("Checking local offline model cache...");
    let modelBytes = 0;
    try {
      if (typeof caches !== "undefined" && typeof caches.match === "function") {
        const cachedRes = await caches.match(modelUrl);
        const len = cachedRes && cachedRes.headers ? cachedRes.headers.get("content-length") : null;
        if (len) modelBytes = parseInt(len, 10) || 0;
      }
    } catch (_err) {
      // Proceed to model load without triggering a redundant HEAD network probe.
    }

    onStatus("Loading local Apache-2.0 Vosk model into WebAssembly...");
    let model = null;
    let recognizer = null;
    try {
      model = await root.Vosk.createModel(modelUrl);
      const grammarJson = JSON.stringify(grammar);
      recognizer = new model.KaldiRecognizer(TARGET_SAMPLE_RATE, grammarJson);

      recognizer.on("result", function (message) {
        const text = message && message.result && message.result.text ? message.result.text : "";
        if (text) {
          onResult({ text, timestampMs: performance.now() });
        }
      });
    } catch (err) {
      const reason = err && err.message ? err.message : String(err || "Unknown model initialization error");
      try {
        if (recognizer && recognizer.remove) recognizer.remove();
        if (model && model.terminate) model.terminate();
      } catch (_teardownErr) {
        // Ignore teardown errors during fallback.
      }
      onStatus("Offline voice engine unavailable (" + reason + ") — switched to Dry-Run mode.");
      return buildDryRunRecognizer(reason);
    }

    const loadTimeMs = Math.round(performance.now() - startTime);
    onStatus("Offline WASM recognizer ready (" + loadTimeMs + " ms).");

    return {
      mode: "vosk-wasm",
      loadTimeMs,
      modelBytes,
      acceptWaveform(audioBuffer) {
        if (recognizer && typeof recognizer.acceptWaveform === "function") {
          recognizer.acceptWaveform(audioBuffer);
        }
      },
      simulateWord(word) {
        onResult({ text: word, timestampMs: performance.now() });
      },
      terminate() {
        try {
          if (recognizer && recognizer.remove) recognizer.remove();
          if (model && model.terminate) model.terminate();
        } catch (_err) {
          // Ignore teardown errors.
        }
      },
    };
  }

  root.Apps4KidsVoskAdapter = {
    TARGET_SAMPLE_RATE,
    DEFAULT_MODEL_URL,
    DEFAULT_SCRIPT_URL,
    tryLoadLocalVoskScript,
    createOfflineRecognizer,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
