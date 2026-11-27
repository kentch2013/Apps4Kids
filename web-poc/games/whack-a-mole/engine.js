(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Apps4KidsWhackAMoleEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HOLE_COUNT = 6;

  const TIER_CONFIG = Object.freeze({
    1: Object.freeze({
      tier: 1,
      maxSimultaneousMoles: 2,
      dwellMs: 12000,
      spawnIntervalMs: 1800,
      roundTargetBops: 8,
      maxRetriesBeforeHint: 2,
      postHintGraceMs: 6000,
    }),
    2: Object.freeze({
      tier: 2,
      maxSimultaneousMoles: 2,
      dwellMs: 9500,
      spawnIntervalMs: 1500,
      roundTargetBops: 10,
      maxRetriesBeforeHint: 2,
      postHintGraceMs: 5000,
    }),
    3: Object.freeze({
      tier: 3,
      maxSimultaneousMoles: 3,
      dwellMs: 7500,
      spawnIntervalMs: 1300,
      roundTargetBops: 12,
      maxRetriesBeforeHint: 2,
      postHintGraceMs: 4500,
    }),
    4: Object.freeze({
      tier: 4,
      maxSimultaneousMoles: 3,
      dwellMs: 6000,
      spawnIntervalMs: 1100,
      roundTargetBops: 14,
      maxRetriesBeforeHint: 2,
      postHintGraceMs: 4000,
    }),
  });

  function normalizeUtteranceSet(item) {
    const out = new Set();
    if (!item || !Array.isArray(item.accepted_utterances)) return out;
    for (const raw of item.accepted_utterances) {
      if (typeof raw !== "string") continue;
      const cleaned = raw
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) out.add(cleaned);
    }
    return out;
  }

  // Enforces both symmetric confusable_with AND dynamic utterance-overlap exclusion
  function isConfusablePair(itemA, itemB) {
    if (!itemA || !itemB) return false;
    if (itemA.id === itemB.id) return true;

    const confA = Array.isArray(itemA.confusable_with) ? itemA.confusable_with : [];
    const confB = Array.isArray(itemB.confusable_with) ? itemB.confusable_with : [];
    if (confA.includes(itemB.id) || confB.includes(itemA.id)) {
      return true;
    }

    const uttA = normalizeUtteranceSet(itemA);
    const uttB = normalizeUtteranceSet(itemB);
    for (const u of uttA) {
      if (uttB.has(u)) return true;
    }
    return false;
  }

  function normalizeDomainKey(domain) {
    return typeof domain === "string" ? domain.trim().toLowerCase().replace(/^\d+_/, "") : "";
  }

  function filterItemsForSession(items, domains, tier) {
    if (!Array.isArray(items)) return [];
    const tierNum = Math.max(1, Math.min(4, Number(tier) || 1));
    const domainSet =
      Array.isArray(domains) && domains.length > 0
        ? new Set(domains.map(normalizeDomainKey).filter(Boolean))
        : null;

    return items.filter(function (item) {
      if (!item || typeof item.id !== "string") return false;
      if (domainSet && item.domain && !domainSet.has(normalizeDomainKey(item.domain))) {
        return false;
      }
      if (typeof item.tier === "number" && item.tier > tierNum) return false;
      if (!Array.isArray(item.accepted_utterances) || item.accepted_utterances.length === 0) {
        return false;
      }
      return true;
    });
  }

  function createWhackAMoleEngine(options) {
    const opts = options || {};
    const items = Array.isArray(opts.items) ? opts.items.slice() : [];
    if (items.length === 0) {
      throw new Error("createWhackAMoleEngine requires a non-empty items array");
    }
    const tier = Math.max(1, Math.min(4, Number(opts.tier) || 1));
    const preset = TIER_CONFIG[tier] || TIER_CONFIG[1];
    const config = {
      tier,
      maxSimultaneousMoles: opts.maxSimultaneousMoles || preset.maxSimultaneousMoles,
      dwellMs: opts.dwellMs || preset.dwellMs,
      spawnIntervalMs: opts.spawnIntervalMs || preset.spawnIntervalMs,
      roundTargetBops: opts.roundTargetBops || preset.roundTargetBops,
      maxRetriesBeforeHint:
        typeof opts.maxRetriesBeforeHint === "number"
          ? opts.maxRetriesBeforeHint
          : preset.maxRetriesBeforeHint,
      postHintGraceMs: opts.postHintGraceMs || preset.postHintGraceMs,
      holeCount: opts.holeCount || HOLE_COUNT,
    };

    const matcherMod = opts.voiceMatcher;
    if (!matcherMod || typeof matcherMod.createCurriculumMatcher !== "function") {
      throw new Error("createWhackAMoleEngine requires voiceMatcher module");
    }
    const matcher = matcherMod.createCurriculumMatcher(items);
    const rng = typeof opts.rng === "function" ? opts.rng : Math.random;

    const itemById = new Map();
    for (const it of items) itemById.set(it.id, it);

    let status = "idle"; // idle | playing | round_complete | stopped
    let bops = 0;
    let totalSpawns = 0;
    let totalHints = 0;
    let unrecognizedCount = 0;
    let micGated = false;
    let lastSpawnMs = -Infinity;
    let activeMoles = [];
    let requeueIds = [];
    let drawDeck = [];

    function refillDeck() {
      drawDeck = items.map(function (it) {
        return it.id;
      });
      // Deterministic Fisher-Yates shuffle using injected rng
      for (let i = drawDeck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = drawDeck[i];
        drawDeck[i] = drawDeck[j];
        drawDeck[j] = tmp;
      }
    }

    function canCoexistWithActive(candidateItem) {
      for (const mole of activeMoles) {
        if (isConfusablePair(candidateItem, mole.item)) {
          return false;
        }
      }
      return true;
    }

    function pickNextCandidateItem() {
      // 1. Prefer gently re-queued items first
      for (let i = 0; i < requeueIds.length; i++) {
        const candidate = itemById.get(requeueIds[i]);
        if (candidate && canCoexistWithActive(candidate)) {
          requeueIds.splice(i, 1);
          return candidate;
        }
      }
      // 2. Draw from shuffled deck
      if (drawDeck.length === 0) refillDeck();
      for (let i = 0; i < drawDeck.length; i++) {
        const candidate = itemById.get(drawDeck[i]);
        if (candidate && canCoexistWithActive(candidate)) {
          drawDeck.splice(i, 1);
          return candidate;
        }
      }
      // 3. Fallback scan across full pool in case deck tail only had conflicting items
      for (const candidate of items) {
        if (canCoexistWithActive(candidate)) {
          return candidate;
        }
      }
      return null;
    }

    function pickFreeHoleIndex() {
      const occupied = new Set(
        activeMoles.map(function (m) {
          return m.holeIndex;
        })
      );
      const free = [];
      for (let i = 0; i < config.holeCount; i++) {
        if (!occupied.has(i)) free.push(i);
      }
      if (free.length === 0) return -1;
      const pick = Math.floor(rng() * free.length);
      return free[Math.min(free.length - 1, Math.max(0, pick))];
    }

    function start(nowMs) {
      const t = typeof nowMs === "number" ? nowMs : Date.now();
      status = "playing";
      bops = 0;
      totalSpawns = 0;
      totalHints = 0;
      unrecognizedCount = 0;
      micGated = false;
      activeMoles = [];
      requeueIds = [];
      refillDeck();
      lastSpawnMs = t - config.spawnIntervalMs;
      return getState();
    }

    function stop() {
      status = "stopped";
      micGated = false;
      return getState();
    }

    function tick(nowMs) {
      const t = typeof nowMs === "number" ? nowMs : Date.now();
      const events = [];
      if (status !== "playing") return events;

      // Pause expiry timers while prerecorded hint audio is playing
      if (!micGated) {
        const remaining = [];
        for (const mole of activeMoles) {
          if (t >= mole.expiresAtMs) {
            if (!requeueIds.includes(mole.itemId)) {
              requeueIds.push(mole.itemId);
            }
            events.push({
              type: "duck_down",
              sfx: "duck_down",
              holeIndex: mole.holeIndex,
              itemId: mole.itemId,
            });
          } else {
            remaining.push(mole);
          }
        }
        activeMoles = remaining;
      }

      // Spawn a new mole if below concurrency cap and interval elapsed (or board is empty)
      const needsImmediate = activeMoles.length === 0;
      const intervalElapsed = t - lastSpawnMs >= config.spawnIntervalMs;
      if (
        activeMoles.length < config.maxSimultaneousMoles &&
        (needsImmediate || intervalElapsed)
      ) {
        const holeIndex = pickFreeHoleIndex();
        const item = pickNextCandidateItem();
        if (holeIndex !== -1 && item) {
          const mole = {
            uid: `mole-${++totalSpawns}`,
            holeIndex,
            itemId: item.id,
            item,
            spawnedAtMs: t,
            expiresAtMs: t + config.dwellMs,
            hinted: false,
          };
          activeMoles.push(mole);
          lastSpawnMs = t;
          events.push({
            type: "pop_up",
            sfx: "pop_up",
            holeIndex: mole.holeIndex,
            itemId: mole.itemId,
            mole,
          });
        }
      }

      return events;
    }

    function handleUtterance(rawText, options) {
      const callOpts = options || {};
      const t = typeof callOpts.nowMs === "number" ? callOpts.nowMs : Date.now();

      if (status !== "playing") {
        return { action: "ignored_not_playing", status };
      }

      if (micGated) {
        return { action: "ignored_mic_gated" };
      }

      const activeIds = activeMoles.map(function (m) {
        return m.itemId;
      });
      const match = matcher.matchActiveMoles(rawText, activeIds, {
        confidence: callOpts.confidence,
        minConfidence: callOpts.minConfidence,
      });

      if (match.command) {
        if (match.command === "stop") {
          status = "stopped";
        }
        return { action: "command", command: match.command, match };
      }

      if (match.matched && match.matchedId) {
        const idx = activeMoles.findIndex(function (m) {
          return m.itemId === match.matchedId;
        });
        if (idx !== -1) {
          const bopped = activeMoles.splice(idx, 1)[0];
          bops++;
          unrecognizedCount = 0;
          const roundComplete = bops >= config.roundTargetBops;
          if (roundComplete) {
            status = "round_complete";
          }
          return {
            action: "bop",
            sfx: "bop",
            winSfx: roundComplete ? "round_win" : null,
            roundComplete,
            mole: bopped,
            match,
            bops,
            roundTargetBops: config.roundTargetBops,
          };
        }
      }

      // Unrecognized speech while moles are visible -> 2 retries then gentle prerecorded hint
      if (activeMoles.length > 0 && match.reason !== "empty") {
        unrecognizedCount++;
        if (unrecognizedCount >= config.maxRetriesBeforeHint) {
          unrecognizedCount = 0;
          const oldest = activeMoles[0];
          oldest.hinted = true;
          oldest.expiresAtMs = Math.max(oldest.expiresAtMs, t) + config.postHintGraceMs;
          micGated = true;
          totalHints++;
          return {
            action: "hint",
            mole: oldest,
            audioSequence: ["prompt:hint_try_saying", `item:${oldest.itemId}`],
            match,
          };
        }
        return {
          action: "retry",
          unrecognizedCount,
          retriesRemaining: config.maxRetriesBeforeHint - unrecognizedCount,
          match,
        };
      }

      return { action: "ignored", match };
    }

    function finishHintPlayback(nowMs) {
      const t = typeof nowMs === "number" ? nowMs : Date.now();
      micGated = false;
      for (const mole of activeMoles) {
        if (mole.expiresAtMs < t + 2500) {
          mole.expiresAtMs = t + 2500;
        }
      }
      return getState();
    }

    function getGrammar() {
      const sessionIds = items.map(function (it) {
        return it.id;
      });
      return matcher.buildConstrainedGrammar(sessionIds, { includeCommands: true });
    }

    function getState() {
      return {
        status,
        tier: config.tier,
        bops,
        roundTargetBops: config.roundTargetBops,
        totalSpawns,
        totalHints,
        unrecognizedCount,
        micGated,
        activeMoles: activeMoles.slice(),
        requeueIds: requeueIds.slice(),
      };
    }

    return {
      config,
      start,
      stop,
      tick,
      handleUtterance,
      finishHintPlayback,
      getGrammar,
      getState,
    };
  }

  return {
    HOLE_COUNT,
    TIER_CONFIG,
    normalizeUtteranceSet,
    isConfusablePair,
    filterItemsForSession,
    createWhackAMoleEngine,
  };
});
