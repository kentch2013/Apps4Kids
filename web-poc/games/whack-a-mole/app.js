(function () {
  "use strict";

  const Launcher = window.Apps4KidsLauncher;
  const EngineMod = window.Apps4KidsWhackAMoleEngine;
  const VoiceMatcher = window.Apps4KidsVoiceMatcher;
  const Cal = window.Apps4KidsCalibration;
  const Resampler = window.Apps4KidsResampler;
  const VoskAdapter = window.Apps4KidsVoskAdapter;

  const screens = {
    setup: document.getElementById("screenSetup"),
    calib: document.getElementById("screenCalib"),
    game: document.getElementById("screenGame"),
    win: document.getElementById("screenWin"),
  };

  const els = {
    swStatus: document.getElementById("swStatus"),
    flowSkillBtn: document.getElementById("flowSkillBtn"),
    flowGameBtn: document.getElementById("flowGameBtn"),
    domainList: document.getElementById("domainList"),
    tierList: document.getElementById("tierList"),
    gameList: document.getElementById("gameList"),
    startSetupBtn: document.getElementById("startSetupBtn"),
    setupError: document.getElementById("setupError"),

    calibStartBtn: document.getElementById("calibStartBtn"),
    calibBackBtn: document.getElementById("calibBackBtn"),
    calibPrompt: document.getElementById("calibPrompt"),
    calibMeter: document.getElementById("calibMeter"),
    calibDryRunBar: document.getElementById("calibDryRunBar"),

    starBar: document.getElementById("starBar"),
    micIndicator: document.getElementById("micIndicator"),
    moleGrid: document.getElementById("moleGrid"),
    parentExitBtn: document.getElementById("parentExitBtn"),
    gameDryRunBar: document.getElementById("gameDryRunBar"),

    winStars: document.getElementById("winStars"),
    playAgainBtn: document.getElementById("playAgainBtn"),
    changeSkillBtn: document.getElementById("changeSkillBtn"),
  };

  let gamesManifest = null;
  let assetsManifest = null;
  let curriculumByDomain = {};

  let launcherFlow = "skill_to_game"; // skill_to_game | game_to_skill
  let selectedDomains = ["02_numbers_quantities", "05_colors_measurement"];
  let selectedTier = 1;
  let selectedGameId = "whack-a-mole";

  let engine = null;
  let tickTimer = null;
  let audioCtx = null;
  let mediaStream = null;
  let processor = null;
  let recognizer = null;
  let voicePhase = "idle"; // idle | stageA | stageB | playing
  let stageAFrames = [];
  let stageAStart = 0;
  let vadThreshold = 0.02;
  let stageBSession = null;
  let activeAudioEl = null;

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      els.swStatus.textContent = "Offline cache unavailable";
      return;
    }
    navigator.serviceWorker
      .register("./sw.js", { scope: "/" })
      .catch(function () {
        return navigator.serviceWorker.register("./sw.js");
      })
      .then(function () {
        els.swStatus.textContent = "Offline ready";
      })
      .catch(function () {
        els.swStatus.textContent = "Local session";
      });
  }

  function playAudioRel(relPath) {
    return new Promise(function (resolve) {
      if (!relPath) {
        resolve();
        return;
      }
      const audio = new Audio("../" + relPath);
      activeAudioEl = audio;
      let done = false;
      function finish() {
        if (done) return;
        done = true;
        if (activeAudioEl === audio) activeAudioEl = null;
        resolve();
      }
      audio.addEventListener("ended", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(finish);
      }
    });
  }

  function playSfx(key) {
    if (!assetsManifest || !assetsManifest.sfx || !assetsManifest.sfx[key]) return;
    const audio = new Audio("../" + assetsManifest.sfx[key].path);
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {});
    }
  }

  async function playHintSequence(audioSequence) {
    for (const token of audioSequence) {
      if (token.startsWith("prompt:")) {
        const key = token.slice("prompt:".length);
        const entry = assetsManifest && assetsManifest.prompts && assetsManifest.prompts[key];
        if (entry) await playAudioRel(entry.path);
      } else if (token.startsWith("item:")) {
        const id = token.slice("item:".length);
        const entry = assetsManifest && assetsManifest.items && assetsManifest.items[id];
        if (entry) await playAudioRel(entry.audio);
      }
    }
    if (engine) {
      engine.finishHintPlayback(Date.now());
      renderBoard();
    }
  }

  function renderSetup() {
    els.flowSkillBtn.classList.toggle("active", launcherFlow === "skill_to_game");
    els.flowGameBtn.classList.toggle("active", launcherFlow === "game_to_skill");
    els.setupError.textContent = "";

    // Domains
    els.domainList.innerHTML = "";
    const eligibleSkills =
      launcherFlow === "game_to_skill"
        ? Launcher.getEligibleSkills(gamesManifest, selectedGameId)
        : null;
    const activeSkillIds = eligibleSkills
      ? new Set(
          eligibleSkills.domains.map(function (d) {
            return d.id;
          })
        )
      : null;

    for (const dom of gamesManifest.domains) {
      const btn = document.createElement("button");
      btn.type = "button";
      const enabled = dom.active && (!activeSkillIds || activeSkillIds.has(dom.id));
      const isSelected = enabled && selectedDomains.includes(dom.id);
      btn.className = "chip" + (isSelected ? " selected" : "");
      btn.disabled = !enabled;
      btn.textContent = dom.active ? dom.label : dom.label + " (Soon)";
      btn.addEventListener("click", function () {
        if (!enabled) return;
        if (selectedDomains.includes(dom.id)) {
          if (selectedDomains.length > 1) {
            selectedDomains = selectedDomains.filter(function (id) {
              return id !== dom.id;
            });
          }
        } else {
          selectedDomains = selectedDomains.concat(dom.id);
        }
        renderSetup();
      });
      els.domainList.appendChild(btn);
    }

    // Tiers
    els.tierList.innerHTML = "";
    const tiers = eligibleSkills ? eligibleSkills.tiers : [1, 2, 3, 4];
    for (const t of tiers) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (selectedTier === t ? " selected" : "");
      btn.textContent = "Tier " + t;
      btn.addEventListener("click", function () {
        selectedTier = t;
        renderSetup();
      });
      els.tierList.appendChild(btn);
    }

    // Games
    els.gameList.innerHTML = "";
    const gamesToShow =
      launcherFlow === "skill_to_game"
        ? Launcher.getEligibleGames(gamesManifest, selectedDomains, selectedTier)
        : gamesManifest.games;

    if (gamesToShow.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No games match this skill selection yet.";
      els.gameList.appendChild(empty);
      els.startSetupBtn.disabled = true;
      return;
    }

    for (const game of gamesToShow) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "game-card" + (selectedGameId === game.id ? " selected" : "");
      card.innerHTML =
        "<strong>" + game.name + "</strong><span>" + game.tagline + "</span>";
      card.addEventListener("click", function () {
        selectedGameId = game.id;
        renderSetup();
      });
      els.gameList.appendChild(card);
    }
    els.startSetupBtn.disabled = false;
  }

  function renderStars(container, filled, total) {
    container.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const span = document.createElement("span");
      span.className = "star" + (i < filled ? " earned" : "");
      span.textContent = "\u2605";
      container.appendChild(span);
    }
  }

  function renderBoard() {
    if (!engine) return;
    const state = engine.getState();
    renderStars(els.starBar, state.bops, state.roundTargetBops);

    els.micIndicator.className = "mic-pill " + (state.micGated ? "gated" : "listening");
    els.micIndicator.setAttribute(
      "aria-label",
      state.micGated ? "Playing hint" : "Listening for child voice"
    );

    const moleByHole = new Map();
    for (const m of state.activeMoles) {
      moleByHole.set(m.holeIndex, m);
    }

    const holes = els.moleGrid.querySelectorAll(".mole-hole");
    holes.forEach(function (holeEl, idx) {
      const mole = moleByHole.get(idx);
      const slot = holeEl.querySelector(".mole-visual");
      if (mole) {
        holeEl.classList.add("active");
        holeEl.classList.toggle("hinted", Boolean(mole.hinted));
        const asset = assetsManifest && assetsManifest.items && assetsManifest.items[mole.itemId];
        const src = asset && asset.visual ? "../" + asset.visual.svg : "";
        if (slot.getAttribute("data-item-id") !== mole.itemId) {
          slot.setAttribute("data-item-id", mole.itemId);
          slot.innerHTML = "";
          if (src) {
            const img = document.createElement("img");
            img.src = src;
            img.alt = "";
            slot.appendChild(img);
          }
        }
      } else {
        holeEl.classList.remove("active", "hinted");
        slot.removeAttribute("data-item-id");
        slot.innerHTML = "";
      }
    });

    // Update dry-run simulator buttons for active moles when Vosk WASM is not staged
    if (recognizer && recognizer.mode === "dry-run") {
      els.gameDryRunBar.hidden = false;
      els.gameDryRunBar.innerHTML = "";
      for (const m of state.activeMoles) {
        const word = m.item.accepted_utterances[0];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sim-btn";
        btn.textContent = word;
        btn.addEventListener("click", function () {
          recognizer.simulateWord(word);
        });
        els.gameDryRunBar.appendChild(btn);
      }
      const wrongBtn = document.createElement("button");
      wrongBtn.type = "button";
      wrongBtn.className = "sim-btn secondary";
      wrongBtn.textContent = "wrong word";
      wrongBtn.addEventListener("click", function () {
        recognizer.simulateWord("banana");
      });
      els.gameDryRunBar.appendChild(wrongBtn);
    }
  }

  function handleRecognizedPayload(payload) {
    const text = payload && payload.text ? payload.text : "";
    if (!text) return;

    if (voicePhase === "stageB" && stageBSession) {
      const expected = stageBSession.currentWord();
      const norm = VoiceMatcher.normalizeTranscript(text);
      const matched = norm.filteredTokens.includes(expected);
      const step = stageBSession.recordAttempt(matched ? expected : norm.cleaned, 120);
      if (step.complete) {
        beginGameplay();
      } else {
        els.calibPrompt.textContent = 'Say "' + stageBSession.currentWord() + '"';
      }
      return;
    }

    if (voicePhase === "playing" && engine) {
      const res = engine.handleUtterance(text, { nowMs: Date.now() });
      if (res.action === "bop") {
        playSfx("bop");
        renderBoard();
        if (res.roundComplete) {
          finishRoundWin();
        }
      } else if (res.action === "hint") {
        renderBoard();
        playHintSequence(res.audioSequence);
      } else if (res.action === "command" && res.command === "stop") {
        teardownSession();
        showScreen("setup");
      }
    }
  }

  function beginGameplay() {
    voicePhase = "playing";
    showScreen("game");
    if (assetsManifest && assetsManifest.prompts && assetsManifest.prompts.round_start) {
      playAudioRel(assetsManifest.prompts.round_start.path);
    }
    engine.start(Date.now());
    const initEvents = engine.tick(Date.now());
    initEvents.forEach(function (ev) {
      if (ev.sfx) playSfx(ev.sfx);
    });
    renderBoard();

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      if (!engine || voicePhase !== "playing") return;
      const events = engine.tick(Date.now());
      if (events.length > 0) {
        events.forEach(function (ev) {
          if (ev.sfx) playSfx(ev.sfx);
        });
        renderBoard();
      }
    }, 250);
  }

  function finishRoundWin() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    voicePhase = "idle";
    playSfx("round_win");
    const st = engine.getState();
    renderStars(els.winStars, st.bops, st.roundTargetBops);
    showScreen("win");
  }

  function teardownSession() {
    voicePhase = "idle";
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (activeAudioEl) {
      activeAudioEl.pause();
      activeAudioEl = null;
    }
    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) {
        t.stop();
      });
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
    els.calibStartBtn.disabled = false;
    els.calibDryRunBar.hidden = true;
    els.gameDryRunBar.hidden = true;
  }

  async function startCalibration() {
    els.calibStartBtn.disabled = true;
    els.calibPrompt.textContent = "Unlocking microphone...";

    const sessionItems = [];
    for (const domId of selectedDomains) {
      const items = curriculumByDomain[domId] || [];
      for (const it of items) {
        sessionItems.push(Object.assign({}, it, { domain: domId }));
      }
    }
    const filtered = EngineMod.filterItemsForSession(sessionItems, selectedDomains, selectedTier);
    engine = EngineMod.createWhackAMoleEngine({
      items: filtered,
      tier: selectedTier,
      voiceMatcher: VoiceMatcher,
    });

    const grammar = Array.from(new Set(engine.getGrammar().concat(Cal.STAGE_B_WORDS)));

    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextCtor();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (_err) {
      // Allow dry-run testing even on headless/no-mic desktops
      audioCtx = null;
      mediaStream = null;
    }

    recognizer = await VoskAdapter.createOfflineRecognizer({
      grammar,
      modelUrl: "./spike-voice/vendor/vosk/vosk-model-small-en-us-0.15.tar.gz",
      onResult: handleRecognizedPayload,
      onStatus: function () {},
    });

    if (recognizer.mode === "dry-run") {
      els.calibDryRunBar.hidden = false;
    }

    if (audioCtx && mediaStream) {
      const source = audioCtx.createMediaStreamSource(mediaStream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      voicePhase = "stageA";
      stageAFrames = [];
      stageAStart = performance.now();
      els.calibPrompt.textContent = "Quiet room check (2 seconds)...";

      processor.onaudioprocess = function (event) {
        const input = event.inputBuffer.getChannelData(0);
        const frameStats = Cal.analyzeFrame(input);
        els.calibMeter.style.width = Math.min(100, Math.round(frameStats.rms * 400)) + "%";

        if (voicePhase === "stageA") {
          stageAFrames.push(new Float32Array(input));
          if (performance.now() - stageAStart >= Cal.STAGE_A_DURATION_MS) {
            const res = Cal.computeStageAResult(stageAFrames);
            vadThreshold = res.vadThresholdRms;
            stageBSession = Cal.createStageBSession();
            voicePhase = "stageB";
            els.calibPrompt.textContent = 'Say "' + stageBSession.currentWord() + '"';
          }
          return;
        }

        if (
          recognizer &&
          recognizer.mode === "vosk-wasm" &&
          frameStats.rms >= vadThreshold &&
          (!engine || !engine.getState().micGated)
        ) {
          const downsampled = Resampler.downsampleFloat32(input, audioCtx.sampleRate, 16000);
          const buf16 = audioCtx.createBuffer(1, downsampled.length, 16000);
          buf16.copyToChannel(downsampled, 0);
          recognizer.acceptWaveform(buf16);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } else {
      stageBSession = Cal.createStageBSession();
      voicePhase = "stageB";
      els.calibPrompt.textContent = 'Dry-run mode: tap "' + stageBSession.currentWord() + '" below';
    }
  }

  async function init() {
    registerServiceWorker();

    // Build 6-hole portrait mole grid
    els.moleGrid.innerHTML = "";
    for (let i = 0; i < EngineMod.HOLE_COUNT; i++) {
      const hole = document.createElement("div");
      hole.className = "mole-hole";
      hole.innerHTML = '<div class="mole-visual"></div><div class="mole-mound"></div>';
      els.moleGrid.appendChild(hole);
    }

    const [gamesRes, assetsRes] = await Promise.all([
      fetch("./games.manifest.json"),
      fetch("../assets/manifest.json"),
    ]);
    gamesManifest = await gamesRes.json();
    assetsManifest = await assetsRes.json();

    const activeDomains = gamesManifest.domains.filter(function (d) {
      return d.active;
    });
    await Promise.all(
      activeDomains.map(async function (dom) {
        const res = await fetch("../" + dom.curriculum_file);
        const data = await res.json();
        curriculumByDomain[dom.id] = data.items || [];
      })
    );

    renderSetup();
    showScreen("setup");
  }

  els.flowSkillBtn.addEventListener("click", function () {
    launcherFlow = "skill_to_game";
    renderSetup();
  });
  els.flowGameBtn.addEventListener("click", function () {
    launcherFlow = "game_to_skill";
    renderSetup();
  });
  els.startSetupBtn.addEventListener("click", function () {
    try {
      Launcher.buildSessionConfig(gamesManifest, {
        gameId: selectedGameId,
        domains: selectedDomains,
        tier: selectedTier,
      });
      showScreen("calib");
    } catch (err) {
      els.setupError.textContent = err.message;
    }
  });
  els.calibStartBtn.addEventListener("click", startCalibration);
  els.calibBackBtn.addEventListener("click", function () {
    teardownSession();
    showScreen("setup");
  });
  els.parentExitBtn.addEventListener("click", function () {
    teardownSession();
    showScreen("setup");
  });
  els.playAgainBtn.addEventListener("click", function () {
    beginGameplay();
  });
  els.changeSkillBtn.addEventListener("click", function () {
    teardownSession();
    showScreen("setup");
  });

  document.querySelectorAll("[data-calib-word]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (recognizer) {
        recognizer.simulateWord(btn.getAttribute("data-calib-word"));
      }
    });
  });

  init().catch(function (err) {
    els.setupError.textContent = "Failed to load offline assets: " + err.message;
  });
})();
