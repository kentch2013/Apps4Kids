#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const validator = require(path.join(ROOT, "scripts", "validate-assets.js"));

// 1. Validator exports contract
assert.strictEqual(typeof validator.validateAssets, "function", "validateAssets must be exported");
assert.strictEqual(typeof validator.validateAudioFile, "function", "validateAudioFile must be exported");
assert.strictEqual(typeof validator.validateSvgFile, "function", "validateSvgFile must be exported");
assert.strictEqual(typeof validator.validateAttribution, "function", "validateAttribution must be exported");
assert.ok(validator.ALLOWED_LICENSES instanceof Set, "ALLOWED_LICENSES Set must be exported");
assert.ok(validator.IOS_SAFARI_AUDIO_EXTS instanceof Set, "IOS_SAFARI_AUDIO_EXTS Set must be exported");

for (const ext of [".wav", ".mp3", ".m4a"]) {
  assert.ok(validator.IOS_SAFARI_AUDIO_EXTS.has(ext), `Missing iOS Safari audio ext: ${ext}`);
}
assert.ok(!validator.IOS_SAFARI_AUDIO_EXTS.has(".ogg"), ".ogg must not be allowed for iOS Safari");

// 2. Unit tests in temp dir for audio, SVG, and attribution validation
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apps4kids-assets-test-"));
try {
  // Valid minimal RIFF/WAVE header (44 bytes + 4 bytes data)
  const validWav = Buffer.alloc(48);
  validWav.write("RIFF", 0, "ascii");
  validWav.writeUInt32LE(40, 4);
  validWav.write("WAVE", 8, "ascii");
  validWav.write("fmt ", 12, "ascii");
  validWav.writeUInt32LE(16, 16);
  validWav.writeUInt16LE(1, 20); // PCM
  validWav.writeUInt16LE(1, 22); // mono
  validWav.writeUInt32LE(16000, 24);
  validWav.writeUInt32LE(32000, 28);
  validWav.writeUInt16LE(2, 32);
  validWav.writeUInt16LE(16, 34);
  validWav.write("data", 36, "ascii");
  validWav.writeUInt32LE(4, 40);
  const wavPath = path.join(tmpDir, "ok.wav");
  fs.writeFileSync(wavPath, validWav);
  assert.deepStrictEqual(validator.validateAudioFile(wavPath, { maxBytes: 1024 }), []);

  // Reject .ogg extension
  const oggPath = path.join(tmpDir, "bad.ogg");
  fs.writeFileSync(oggPath, Buffer.from("OggS0000000000000000"));
  assert.ok(validator.validateAudioFile(oggPath, { maxBytes: 1024 }).length > 0, ".ogg must fail");

  // Reject corrupted .wav magic bytes
  const corruptWavPath = path.join(tmpDir, "corrupt.wav");
  fs.writeFileSync(corruptWavPath, Buffer.from("NOT_A_WAV_FILE_HEADER_123456"));
  assert.ok(validator.validateAudioFile(corruptWavPath, { maxBytes: 1024 }).length > 0, "corrupt wav must fail");

  // Reject oversized audio file
  assert.ok(validator.validateAudioFile(wavPath, { maxBytes: 16 }).length > 0, "oversized wav must fail");

  // Valid offline SVG
  const okSvgPath = path.join(tmpDir, "ok.svg");
  fs.writeFileSync(
    okSvgPath,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><circle cx="120" cy="120" r="80" fill="#E63946"/></svg>\n',
    "utf8"
  );
  assert.deepStrictEqual(validator.validateSvgFile(okSvgPath), []);

  // Reject SVG with <script>
  const xssSvgPath = path.join(tmpDir, "xss.svg");
  fs.writeFileSync(
    xssSvgPath,
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    "utf8"
  );
  assert.ok(validator.validateSvgFile(xssSvgPath).length > 0, "SVG with <script> must fail");

  // Reject SVG with external URL
  const extSvgPath = path.join(tmpDir, "external.svg");
  fs.writeFileSync(
    extSvgPath,
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>',
    "utf8"
  );
  assert.ok(validator.validateSvgFile(extSvgPath).length > 0, "SVG with external URL must fail");

  // Valid attribution entries
  const goodAttr = {
    schema_version: 1,
    assets: [
      {
        path: "assets/audio/sfx/bop.wav",
        title: "Soft Cartoon Bop",
        author: "kentch2013",
        source_url: "original",
        license: "Original",
        license_url: "LICENSE",
      },
    ],
  };
  assert.deepStrictEqual(
    validator.validateAttribution(goodAttr, new Set(["assets/audio/sfx/bop.wav"])),
    []
  );

  // Reject disallowed licenses (GPL, CC-BY-SA, CC-BY-NC)
  for (const badLic of ["GPL-3.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "LGPL-2.1"]) {
    const badAttr = {
      schema_version: 1,
      assets: [
        {
          path: "assets/audio/sfx/bop.wav",
          title: "Bad",
          author: "Someone",
          source_url: "https://example.org/bad",
          license: badLic,
          license_url: "https://example.org/license",
        },
      ],
    };
    assert.ok(
      validator.validateAttribution(badAttr, new Set(["assets/audio/sfx/bop.wav"])).length > 0,
      `Disallowed license ${badLic} must fail`
    );
  }

  // Reject missing provenance coverage for an asset file on disk
  assert.ok(
    validator.validateAttribution(goodAttr, new Set(["assets/audio/sfx/bop.wav", "assets/audio/sfx/untracked.wav"]))
      .length > 0,
    "Untracked asset file must fail attribution coverage"
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// 3. Integration check against real repository assets/
const result = validator.validateAssets(ROOT);
assert.deepStrictEqual(
  result.errors,
  [],
  `Repository asset validation failed:\n${result.errors.join("\n")}`
);
assert.strictEqual(result.summary.domainCount, 9, "Manifest must declare all 9 curriculum domains");
assert.deepStrictEqual(
  result.summary.activeDomains.slice().sort(),
  ["02_numbers_quantities", "05_colors_measurement"],
  "Active vertical slice must be Numbers and Colors"
);
assert.strictEqual(result.summary.itemCount, 95, "Expected 95 core items (61 Numbers + 34 Colors/Measurement)");
assert.ok(result.summary.sfxCount >= 4, "Expected at least 4 non-verbal SFX clips");
assert.ok(result.summary.promptCount >= 5, "Expected at least 5 prerecorded prompt clips");
assert.strictEqual(
  result.summary.attributionCount,
  result.summary.diskAssetCount,
  "Every asset file under assets/audio and assets/visuals must have an ATTRIBUTION.json entry"
);

console.log(
  `ASSETS PIPELINE TESTS PASSED | domains=${result.summary.domainCount}, items=${result.summary.itemCount}, sfx=${result.summary.sfxCount}, prompts=${result.summary.promptCount}, attributed=${result.summary.attributionCount}`
);
