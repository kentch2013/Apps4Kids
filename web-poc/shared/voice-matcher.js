(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Apps4KidsVoiceMatcher = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_MIN_CONFIDENCE = 0.45;
  const MIN_FUZZY_TOKEN_LEN = 4;
  const MAX_FUZZY_DISTANCE = 1;

  const FILLER_WORDS = new Set([
    "um",
    "uh",
    "uhh",
    "umm",
    "the",
    "a",
    "an",
    "it",
    "is",
    "its",
    "that",
    "thats",
    "this",
    "like",
    "hey",
    "look",
    "see",
  ]);

  const CONTROL_COMMANDS = Object.freeze({
    stop: "stop",
    pause: "stop",
    repeat: "repeat",
    again: "repeat",
  });

  // Preschool articulation & phonetic normalization map -> canonical English token
  const PHONETIC_ALIASES = Object.freeze({
    fwee: "three",
    thwee: "three",
    wed: "red",
    bwoo: "blue",
    bue: "blue",
    gween: "green",
    yewow: "yellow",
    yello: "yellow",
    owange: "orange",
    puwple: "purple",
    bwown: "brown",
    bwack: "black",
    gwey: "gray",
    fow: "four",
    fibe: "five",
    seben: "seven",
    tewen: "ten",
    twelbe: "twelve",
  });

  function normalizeTranscript(rawText) {
    if (typeof rawText !== "string") {
      return { cleaned: "", tokens: [], filteredTokens: [] };
    }
    const cleaned = rawText
      .toLowerCase()
      .replace(/[^a-z0-9\s\[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) {
      return { cleaned: "", tokens: [], filteredTokens: [] };
    }
    const tokens = cleaned.split(" ");
    const filteredTokens = tokens.filter((t) => t && t !== "[unk]" && !FILLER_WORDS.has(t));
    return { cleaned, tokens, filteredTokens };
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const prev = new Array(n + 1);
    const curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
  }

  function createCurriculumMatcher(items) {
    if (!Array.isArray(items)) {
      throw new TypeError("createCurriculumMatcher expects an array of curriculum items");
    }

    const itemById = new Map();
    const utterancesById = new Map();

    for (const item of items) {
      if (!item || typeof item.id !== "string") continue;
      itemById.set(item.id, item);
      const list = Array.isArray(item.accepted_utterances)
        ? item.accepted_utterances
            .filter((u) => typeof u === "string" && u.trim().length > 0)
            .map((u) => u.toLowerCase().trim())
        : [];
      utterancesById.set(item.id, list);
    }

    function getItem(id) {
      return itemById.get(id) || null;
    }

    function buildConstrainedGrammar(activeMoleIds, options) {
      const opts = options || {};
      const includeCommands = opts.includeCommands !== false;
      const words = new Set();
      if (Array.isArray(activeMoleIds)) {
        for (const id of activeMoleIds) {
          const utterances = utterancesById.get(id);
          if (!utterances) continue;
          for (const utt of utterances) {
            for (const tok of utt.split(/\s+/)) {
              if (tok) words.add(tok);
            }
          }
        }
      }
      if (includeCommands) {
        words.add("stop");
        words.add("repeat");
      }
      const list = Array.from(words);
      list.push("[unk]");
      return list;
    }

    function findActiveMatchesForUtterance(candidate, activeIds) {
      const hits = [];
      for (const id of activeIds) {
        const utterances = utterancesById.get(id);
        if (!utterances) continue;
        if (utterances.includes(candidate)) {
          hits.push({ id, utterance: candidate });
        }
      }
      return hits;
    }

    function matchActiveMoles(rawText, activeMoleIds, options) {
      const opts = options || {};
      const confidence = typeof opts.confidence === "number" ? opts.confidence : 1.0;
      const minConfidence =
        typeof opts.minConfidence === "number" ? opts.minConfidence : DEFAULT_MIN_CONFIDENCE;
      const allowFuzzy = opts.allowFuzzy !== false;
      const allowCommands = opts.allowCommands !== false;

      const base = {
        matched: false,
        matchedId: null,
        matchedUtterance: null,
        matchType: null,
        command: null,
        ambiguous: false,
        candidateIds: [],
        confidence,
        reason: "no_match",
      };

      if (confidence < minConfidence) {
        return Object.assign({}, base, { reason: "low_confidence" });
      }

      const norm = normalizeTranscript(rawText);
      if (!norm.cleaned) {
        return Object.assign({}, base, { reason: "empty" });
      }
      if (norm.cleaned === "[unk]" || norm.filteredTokens.length === 0) {
        return Object.assign({}, base, {
          reason: norm.tokens.includes("[unk]") ? "unk" : "empty",
        });
      }

      const activeIds = Array.isArray(activeMoleIds)
        ? activeMoleIds.filter((id) => itemById.has(id))
        : [];

      // 1. Exact full-phrase match against active moles
      if (activeIds.length > 0) {
        const phraseHits = findActiveMatchesForUtterance(norm.filteredTokens.join(" "), activeIds);
        if (phraseHits.length > 0) {
          return Object.assign({}, base, {
            matched: true,
            matchedId: phraseHits[0].id,
            matchedUtterance: phraseHits[0].utterance,
            matchType: "exact",
            ambiguous: phraseHits.length > 1,
            candidateIds: phraseHits.map((h) => h.id),
            reason: "matched",
          });
        }

        // 2. Exact token match (scan from last token backward for self-corrections)
        for (let i = norm.filteredTokens.length - 1; i >= 0; i--) {
          const tok = norm.filteredTokens[i];
          const hits = findActiveMatchesForUtterance(tok, activeIds);
          if (hits.length > 0) {
            return Object.assign({}, base, {
              matched: true,
              matchedId: hits[0].id,
              matchedUtterance: hits[0].utterance,
              matchType: "exact",
              ambiguous: hits.length > 1,
              candidateIds: hits.map((h) => h.id),
              reason: "matched",
            });
          }
        }
      }

      // 3. Control command detection (e.g., "stop", "repeat")
      if (allowCommands) {
        for (let i = norm.filteredTokens.length - 1; i >= 0; i--) {
          const cmd = CONTROL_COMMANDS[norm.filteredTokens[i]];
          if (cmd) {
            return Object.assign({}, base, {
              matched: false,
              command: cmd,
              matchType: "command",
              reason: "command",
            });
          }
        }
      }

      if (activeIds.length === 0) {
        return Object.assign({}, base, { reason: "no_active_moles" });
      }

      // 4. Preschool phonetic normalization match
      for (let i = norm.filteredTokens.length - 1; i >= 0; i--) {
        const tok = norm.filteredTokens[i];
        const phonetic = PHONETIC_ALIASES[tok];
        if (!phonetic) continue;
        const hits = findActiveMatchesForUtterance(phonetic, activeIds);
        if (hits.length > 0) {
          return Object.assign({}, base, {
            matched: true,
            matchedId: hits[0].id,
            matchedUtterance: hits[0].utterance,
            matchType: "phonetic",
            ambiguous: hits.length > 1,
            candidateIds: hits.map((h) => h.id),
            reason: "matched",
          });
        }
      }

      // 5. Bounded fuzzy Levenshtein match (len >= 4, dist <= 1, unambiguous best distance)
      if (allowFuzzy) {
        for (let i = norm.filteredTokens.length - 1; i >= 0; i--) {
          const tok = norm.filteredTokens[i];
          if (tok.length < MIN_FUZZY_TOKEN_LEN) continue;
          const fuzzyHits = [];
          for (const id of activeIds) {
            const utterances = utterancesById.get(id) || [];
            let bestForItem = Infinity;
            let bestUtt = null;
            for (const utt of utterances) {
              if (utt.length < MIN_FUZZY_TOKEN_LEN || utt.includes(" ")) continue;
              const d = levenshtein(tok, utt);
              if (d <= MAX_FUZZY_DISTANCE && d < bestForItem) {
                bestForItem = d;
                bestUtt = utt;
              }
            }
            if (bestUtt !== null) {
              fuzzyHits.push({ id, utterance: bestUtt, dist: bestForItem });
            }
          }
          if (fuzzyHits.length === 1) {
            return Object.assign({}, base, {
              matched: true,
              matchedId: fuzzyHits[0].id,
              matchedUtterance: fuzzyHits[0].utterance,
              matchType: "fuzzy",
              ambiguous: false,
              candidateIds: [fuzzyHits[0].id],
              reason: "matched",
            });
          }
        }
      }

      return base;
    }

    return {
      getItem,
      buildConstrainedGrammar,
      matchActiveMoles,
    };
  }

  function evaluateVadGate(pcmFloat32, sampleRate, calibrationModule, options) {
    const opts = options || {};
    const frameMs = typeof opts.frameMs === "number" ? opts.frameMs : 20;
    const minSpeechFrames = typeof opts.minSpeechFrames === "number" ? opts.minSpeechFrames : 2;
    const noiseFloorRms = typeof opts.noiseFloorRms === "number" ? opts.noiseFloorRms : 0.008;

    const vadThresholdRms =
      typeof opts.vadThresholdRms === "number"
        ? opts.vadThresholdRms
        : calibrationModule.computeStageAResult([new Float32Array(256).fill(noiseFloorRms)])
            .vadThresholdRms;

    if (!pcmFloat32 || pcmFloat32.length === 0) {
      return {
        speechDetected: false,
        maxFrameRms: 0,
        speechFrames: 0,
        totalFrames: 0,
        vadThresholdRms,
      };
    }

    const frameSize = Math.max(1, Math.floor((sampleRate * frameMs) / 1000));
    let maxFrameRms = 0;
    let speechFrames = 0;
    let totalFrames = 0;

    for (let offset = 0; offset + frameSize <= pcmFloat32.length; offset += frameSize) {
      const slice = pcmFloat32.subarray(offset, offset + frameSize);
      const stats = calibrationModule.analyzeFrame(slice);
      totalFrames++;
      if (stats.rms > maxFrameRms) maxFrameRms = stats.rms;
      if (!stats.isMuted && stats.rms >= vadThresholdRms) {
        speechFrames++;
      }
    }

    return {
      speechDetected: speechFrames >= minSpeechFrames,
      maxFrameRms,
      speechFrames,
      totalFrames,
      vadThresholdRms,
    };
  }

  return {
    DEFAULT_MIN_CONFIDENCE,
    FILLER_WORDS,
    CONTROL_COMMANDS,
    PHONETIC_ALIASES,
    normalizeTranscript,
    levenshtein,
    createCurriculumMatcher,
    evaluateVadGate,
  };
});
