(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Apps4KidsResampler = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function downsampleFloat32(input, inputSampleRate, targetSampleRate) {
    if (!input || input.length === 0) return new Float32Array(0);
    if (!inputSampleRate || !targetSampleRate || inputSampleRate === targetSampleRate) {
      return new Float32Array(input);
    }
    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const srcPos = i * ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = input[idx] || 0;
      const s1 = idx + 1 < input.length ? input[idx + 1] : s0;
      output[i] = s0 + (s1 - s0) * frac;
    }
    return output;
  }

  function floatToInt16PCM(floatSamples) {
    const out = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
      out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
    return out;
  }

  return {
    downsampleFloat32,
    floatToInt16PCM,
  };
});
