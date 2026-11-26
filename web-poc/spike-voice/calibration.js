(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Apps4KidsCalibration = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STAGE_A_DURATION_MS = 2000;
  const STAGE_B_WORDS = Object.freeze(["red", "two", "blue"]);
  const MUTE_RMS_FLOOR = 0.0005;
  const CLIP_PEAK_THRESHOLD = 0.98;
  const VAD_MULTIPLIER = 2.5;
  const MIN_VAD_RMS = 0.015;
  const MAX_VAD_RMS = 0.25;

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function rmsToDbfs(rms) {
    if (!rms || rms <= 0) return -100;
    return 20 * Math.log10(rms);
  }

  function analyzeFrame(samples) {
    if (!samples || samples.length === 0) {
      return { rms: 0, peak: 0, dbfs: -100, isMuted: true, isClipped: false };
    }
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      const absV = v < 0 ? -v : v;
      sumSq += v * v;
      if (absV > peak) peak = absV;
    }
    const rms = Math.sqrt(sumSq / samples.length);
    return {
      rms,
      peak,
      dbfs: rmsToDbfs(rms),
      isMuted: rms < MUTE_RMS_FLOOR,
      isClipped: peak >= CLIP_PEAK_THRESHOLD,
    };
  }

  function computeStageAResult(frames) {
    if (!frames || frames.length === 0) {
      return {
        status: "muted",
        noiseFloorRms: 0,
        noiseFloorDbfs: -100,
        vadThresholdRms: MIN_VAD_RMS,
        clippedFrames: 0,
      };
    }
    let rmsSum = 0;
    let clippedFrames = 0;
    let mutedFrames = 0;
    for (let i = 0; i < frames.length; i++) {
      const stats = analyzeFrame(frames[i]);
      rmsSum += stats.rms;
      if (stats.isClipped) clippedFrames++;
      if (stats.isMuted) mutedFrames++;
    }
    const noiseFloorRms = rmsSum / frames.length;
    const noiseFloorDbfs = rmsToDbfs(noiseFloorRms);
    const vadThresholdRms = clamp(noiseFloorRms * VAD_MULTIPLIER, MIN_VAD_RMS, MAX_VAD_RMS);
    let status = "ok";
    if (mutedFrames === frames.length) {
      status = "muted";
    } else if (clippedFrames > Math.floor(frames.length * 0.2)) {
      status = "clipped";
    }
    return {
      status,
      noiseFloorRms,
      noiseFloorDbfs,
      vadThresholdRms,
      clippedFrames,
    };
  }

  function createStageBSession(words) {
    const targetWords = Array.isArray(words) && words.length > 0 ? words.slice() : STAGE_B_WORDS.slice();
    let index = 0;
    const attempts = [];

    return {
      currentWord() {
        return index < targetWords.length ? targetWords[index] : null;
      },
      recordAttempt(heardCanonical, latencyMs) {
        const expected = this.currentWord();
        if (expected === null) {
          return { matched: false, expected: null, complete: true };
        }
        const matched = heardCanonical === expected;
        attempts.push({
          expected,
          heard: heardCanonical || null,
          matched,
          latencyMs: typeof latencyMs === "number" ? latencyMs : null,
        });
        if (matched) index++;
        return { matched, expected, complete: index >= targetWords.length };
      },
      isComplete() {
        return index >= targetWords.length;
      },
      summary() {
        const matchedAttempts = attempts.filter((a) => a.matched && typeof a.latencyMs === "number");
        const meanLatencyMs =
          matchedAttempts.length > 0
            ? matchedAttempts.reduce((acc, a) => acc + a.latencyMs, 0) / matchedAttempts.length
            : 0;
        return {
          totalExpected: targetWords.length,
          matchedCount: index,
          totalAttempts: attempts.length,
          meanLatencyMs,
          attempts: attempts.slice(),
        };
      },
    };
  }

  return {
    STAGE_A_DURATION_MS,
    STAGE_B_WORDS,
    analyzeFrame,
    rmsToDbfs,
    computeStageAResult,
    createStageBSession,
  };
});
