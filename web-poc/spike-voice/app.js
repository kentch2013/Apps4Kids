(function () {
  "use strict";

  const Cal = window.Apps4KidsCalibration;
  const Resampler = window.Apps4KidsResampler;
  const Matcher = window.Apps4KidsVocabMatcher;
  const VoskAdapter = window.Apps4KidsVoskAdapter;

  const els = {
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    exportBtn: document.getElementById("exportBtn"),
    statusBadge: document.getElementById("statusBadge"),
    swStatus: document.getElementById("swStatus"),
    stagePrompt: document.getElementById("stagePrompt"),
    rmsMeter: document.getElementById("rmsMeter"),
    vadThresholdVal: document.getElementById("vadThresholdVal"),
    loadTimeVal: document.getElementById("loadTimeVal"),
    modelSizeVal: document.getElementById("modelSizeVal"),
    stabilityVal: document.getElementById("stabilityVal"),
    latencyVal: document.getElementById("latencyVal"),
    fpVal: document.getElementById("fpVal"),
    logBox: document.getElementById("logBox"),
    dryRunBar: document.getElementById("dryRunBar"),
  };

  let audioCtx = null;
  let mediaStream = null;
  let processor = null;
  let recognizer = null;
  let stabilityTimer = null;
  let phase = "idle"; // idle | stageA | stageB | listening
  let stageAFrames = [];
  let stageAStart = 0;
  let vadThreshold = 0.02;
  let lastSpeechEndMs = 0;
  let inSpeech = false;
  let stageBSession = null;

  const metrics = {
    userAgent: navigator.userAgent,
    onlineAtStart: navigator.onLine,
    engineMode: "uninitialized",
    sampleRateHz: 0,
    modelSizeMb: 0,
    coldStartLoadMs: 0,
    noiseFloorDbfs: null,
    vadThresholdRms: null,
    stageBSummary: null,
    stabilitySeconds: 0,
    latenciesMs: [],
    matchedTokens: [],
    falsePositives: 0,
  };

  function log(msg) {
    const ts = new Date().toISOString().slice(11, 23);
    els.logBox.textContent = `[${ts}] ${msg}\n` + els.logBox.textContent;
  }

  function setStatus(text) {
    els.statusBadge.textContent = text;
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("./sw.js")
        .then(function () {
          els.swStatus.textContent = "Service Worker active (offline ready)";
        })
        .catch(function (err) {
          els.swStatus.textContent = "SW error: " + err.message;
        });
    } else {
      els.swStatus.textContent = "Service Worker unsupported";
    }
  }

  function handleRecognizedText(payload) {
    const now = payload.timestampMs || performance.now();
    const latencyMs = lastSpeechEndMs > 0 ? Math.max(0, Math.round(now - lastSpeechEndMs)) : 0;
    const res = Matcher.matchUtterance(payload.text);

    if (!res.matched) {
      log(`Ignored/UNK: "${payload.text}"`);
      return;
    }

    metrics.latenciesMs.push(latencyMs);
    metrics.matchedTokens.push({ token: res.canonical, category: res.category, latencyMs });
    els.latencyVal.textContent = latencyMs + " ms";
    log(`Matched [${res.category}] "${res.canonical}" (raw: "${payload.text}", ${latencyMs} ms)`);

    if (phase === "stageB" && stageBSession) {
      const step = stageBSession.recordAttempt(res.canonical, latencyMs);
      if (step.complete) {
        metrics.stageBSummary = stageBSession.summary();
        phase = "listening";
        els.stagePrompt.textContent = "Calibration Complete! Say any number (1–10), color, 'repeat', or 'stop'.";
        setStatus("Listening (3-min Stability Test)");
        startStabilityClock();
      } else {
        els.stagePrompt.textContent = `Stage B Calibration: Say "${stageBSession.currentWord()}"`;
      }
      return;
    }

    if (phase === "listening") {
      if (!inSpeech && lastSpeechEndMs === 0) {
        metrics.falsePositives++;
        els.fpVal.textContent = String(metrics.falsePositives);
      }
      if (res.canonical === "stop") {
        stopSession("Stopped by voice command ('stop').");
      } else if (res.canonical === "repeat") {
        els.stagePrompt.textContent = "Say any number (1–10), color, 'repeat', or 'stop'.";
      } else {
        els.stagePrompt.textContent = `Heard: ${res.canonical.toUpperCase()}`;
      }
    }
  }

  function startStabilityClock() {
    const startMs = Date.now();
    stabilityTimer = setInterval(function () {
      const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
      metrics.stabilitySeconds = elapsedSec;
      els.stabilityVal.textContent = `${elapsedSec}s / 180s`;
      if (elapsedSec >= 180) {
        log("3-minute continuous listening stability target reached!");
      }
    }, 1000);
  }

  async function startSession() {
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    setStatus("Initializing Audio & Offline Engine...");
    log("Parent tap received — unlocking AudioContext and microphone.");

    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextCtor();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      metrics.sampleRateHz = audioCtx.sampleRate;
      log(`AudioContext unlocked at ${audioCtx.sampleRate} Hz.`);

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      recognizer = await VoskAdapter.createOfflineRecognizer({
        grammar: Matcher.getVoskGrammarList(),
        onResult: handleRecognizedText,
        onStatus: log,
      });
      metrics.engineMode = recognizer.mode;
      metrics.coldStartLoadMs = recognizer.loadTimeMs;
      metrics.modelSizeMb = Number((recognizer.modelBytes / (1024 * 1024)).toFixed(2));
      els.loadTimeVal.textContent = `${metrics.coldStartLoadMs} ms`;
      els.modelSizeVal.textContent = `${metrics.modelSizeMb} MB (${metrics.engineMode})`;

      if (recognizer.mode === "dry-run") {
        els.dryRunBar.hidden = false;
      }

      const source = audioCtx.createMediaStreamSource(mediaStream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      phase = "stageA";
      stageAFrames = [];
      stageAStart = performance.now();
      setStatus("Stage A: Measuring Room Noise (2s)");
      els.stagePrompt.textContent = "Stay quiet for 2 seconds while measuring room noise...";

      processor.onaudioprocess = function (event) {
        const input = event.inputBuffer.getChannelData(0);
        const frameStats = Cal.analyzeFrame(input);
        const pct = Math.min(100, Math.round(frameStats.rms * 400));
        els.rmsMeter.style.width = pct + "%";

        if (phase === "stageA") {
          stageAFrames.push(new Float32Array(input));
          if (performance.now() - stageAStart >= Cal.STAGE_A_DURATION_MS) {
            const stageARes = Cal.computeStageAResult(stageAFrames);
            vadThreshold = stageARes.vadThresholdRms;
            metrics.noiseFloorDbfs = Number(stageARes.noiseFloorDbfs.toFixed(1));
            metrics.vadThresholdRms = Number(vadThreshold.toFixed(4));
            els.vadThresholdVal.textContent = `${metrics.vadThresholdRms} (${metrics.noiseFloorDbfs} dBFS)`;
            log(`Stage A complete: status=${stageARes.status}, floor=${metrics.noiseFloorDbfs} dBFS, VAD=${metrics.vadThresholdRms}`);
            stageBSession = Cal.createStageBSession();
            phase = "stageB";
            setStatus("Stage B: Spoken Word Check");
            els.stagePrompt.textContent = `Stage B Calibration: Say "${stageBSession.currentWord()}"`;
          }
          return;
        }

        const isVoice = frameStats.rms >= vadThreshold;
        if (inSpeech && !isVoice) {
          lastSpeechEndMs = performance.now();
        }
        inSpeech = isVoice;

        if (recognizer && recognizer.mode === "vosk-wasm") {
          const downsampled = Resampler.downsampleFloat32(input, audioCtx.sampleRate, 16000);
          const buf16 = audioCtx.createBuffer(1, downsampled.length, 16000);
          buf16.copyToChannel(downsampled, 0);
          recognizer.acceptWaveform(buf16);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (err) {
      log("Error starting session: " + err.message);
      stopSession("Error: " + err.message);
    }
  }

  function stopSession(reason) {
    phase = "idle";
    if (stabilityTimer) {
      clearInterval(stabilityTimer);
      stabilityTimer = null;
    }
    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    if (recognizer) {
      recognizer.terminate();
      recognizer = null;
    }
    els.startBtn.disabled = false;
    els.stopBtn.disabled = true;
    setStatus(reason || "Stopped");
    log(reason || "Session stopped.");
  }

  function exportMetrics() {
    const out = JSON.stringify(metrics, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out).catch(function () {});
    }
    log("Benchmark JSON exported:\n" + out);
  }

  els.startBtn.addEventListener("click", startSession);
  els.stopBtn.addEventListener("click", function () {
    stopSession("Stopped manually.");
  });
  els.exportBtn.addEventListener("click", exportMetrics);

  document.querySelectorAll("[data-sim-word]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (recognizer) {
        lastSpeechEndMs = performance.now() - 45;
        recognizer.simulateWord(btn.getAttribute("data-sim-word"));
      }
    });
  });

  registerServiceWorker();
})();
