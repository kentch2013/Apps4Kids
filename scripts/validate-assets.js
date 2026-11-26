#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const CANONICAL_DOMAINS = [
  "01_letters_phonics",
  "02_numbers_quantities",
  "03_shapes_spatial",
  "04_patterns_logic",
  "05_colors_measurement",
  "06_animals_nature",
  "07_everyday_objects",
  "08_emotions_social",
  "09_time_weather_seasons",
];

const REQUIRED_SFX = ["bop", "pop_up", "duck_down", "round_win"];

const REQUIRED_PROMPTS = [
  "hint_try_saying",
  "calib_say_hi",
  "calib_great_job",
  "round_start",
  "try_again_gentle",
];

const IOS_SAFARI_AUDIO_EXTS = new Set([".wav", ".mp3", ".m4a"]);

const ALLOWED_LICENSES = new Set([
  "Original",
  "CC0-1.0",
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unlicense",
  "Zlib",
  "CC-BY-4.0",
]);

const DISALLOWED_LICENSE_PATTERN = /(GPL|AGPL|LGPL|SA|NC|ND)/i;

const MAX_ITEM_AUDIO_BYTES = 256 * 1024;
const MAX_SFX_AUDIO_BYTES = 128 * 1024;
const MAX_SVG_BYTES = 32 * 1024;

function toPosix(relPath) {
  return String(relPath || "").replace(/\\/g, "/");
}

function validateAudioFile(absPath, options) {
  const opts = options || {};
  const maxBytes = typeof opts.maxBytes === "number" ? opts.maxBytes : MAX_ITEM_AUDIO_BYTES;
  const label = opts.label || path.basename(absPath);
  const errors = [];

  if (!fs.existsSync(absPath)) {
    return [`${label}: audio file does not exist (${absPath})`];
  }

  const ext = path.extname(absPath).toLowerCase();
  if (!IOS_SAFARI_AUDIO_EXTS.has(ext)) {
    errors.push(
      `${label}: unsupported or non-iOS-Safari audio extension "${ext}" (allowed: .wav, .mp3, .m4a)`
    );
  }

  const stat = fs.statSync(absPath);
  if (stat.size < 16) {
    errors.push(`${label}: audio file is too small (${stat.size} bytes)`);
    return errors;
  }
  if (stat.size > maxBytes) {
    errors.push(`${label}: audio file exceeds size budget (${stat.size} > ${maxBytes} bytes)`);
  }

  const fd = fs.openSync(absPath, "r");
  const header = Buffer.alloc(Math.min(44, stat.size));
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (ext === ".wav") {
    const riff = header.slice(0, 4).toString("ascii");
    const wave = header.slice(8, 12).toString("ascii");
    if (riff !== "RIFF" || wave !== "WAVE") {
      errors.push(`${label}: invalid WAV header (expected RIFF/WAVE)`);
    }
  } else if (ext === ".mp3") {
    const id3 = header.slice(0, 3).toString("ascii") === "ID3";
    const frameSync = header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
    if (!id3 && !frameSync) {
      errors.push(`${label}: invalid MP3 header (expected ID3 or MPEG frame sync)`);
    }
  } else if (ext === ".m4a") {
    const ftyp = header.slice(4, 8).toString("ascii");
    if (ftyp !== "ftyp") {
      errors.push(`${label}: invalid M4A header (expected ISO BMFF ftyp box)`);
    }
  }

  return errors;
}

function validateSvgFile(absPath, options) {
  const opts = options || {};
  const maxBytes = typeof opts.maxBytes === "number" ? opts.maxBytes : MAX_SVG_BYTES;
  const label = opts.label || path.basename(absPath);
  const errors = [];

  if (!fs.existsSync(absPath)) {
    return [`${label}: SVG file does not exist (${absPath})`];
  }

  const stat = fs.statSync(absPath);
  if (stat.size < 20) {
    errors.push(`${label}: SVG file is too small (${stat.size} bytes)`);
    return errors;
  }
  if (stat.size > maxBytes) {
    errors.push(`${label}: SVG file exceeds size budget (${stat.size} > ${maxBytes} bytes)`);
  }

  const raw = fs.readFileSync(absPath, "utf8").trim();
  if (!raw.startsWith("<svg") || !raw.endsWith("</svg>")) {
    errors.push(`${label}: SVG must start with <svg and end with </svg>`);
  }
  if (/<script\b/i.test(raw)) {
    errors.push(`${label}: SVG must not contain <script> elements`);
  }
  // Allow only the standard SVG XML namespace URI; forbid all other http/https external links
  const withoutXmlns = raw
    .replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")
    .replace(/xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/g, "");
  if (/https?:\/\//i.test(withoutXmlns)) {
    errors.push(`${label}: SVG must be 100% offline (found external http/https reference)`);
  }

  return errors;
}

function validateAttribution(attrData, diskAssetSet) {
  const errors = [];
  if (!attrData || typeof attrData !== "object") {
    return ["ATTRIBUTION.json must be a JSON object"];
  }
  if (attrData.schema_version !== 1) {
    errors.push(`ATTRIBUTION.json schema_version must be 1 (got ${attrData.schema_version})`);
  }
  if (!Array.isArray(attrData.assets)) {
    errors.push("ATTRIBUTION.json must contain an assets array");
    return errors;
  }

  const seenPaths = new Set();
  const requiredFields = ["path", "title", "author", "source_url", "license", "license_url"];

  for (let i = 0; i < attrData.assets.length; i++) {
    const entry = attrData.assets[i];
    const ctx = `ATTRIBUTION.json[${i}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${ctx}: entry must be an object`);
      continue;
    }
    for (const field of requiredFields) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        errors.push(`${ctx}: missing or empty required field "${field}"`);
      }
    }
    if (typeof entry.path === "string") {
      const norm = toPosix(entry.path);
      if (!norm.startsWith("assets/")) {
        errors.push(`${ctx}: path must start with "assets/" (got "${norm}")`);
      }
      if (seenPaths.has(norm)) {
        errors.push(`${ctx}: duplicate attribution path "${norm}"`);
      }
      seenPaths.add(norm);
    }
    if (typeof entry.license === "string") {
      if (!ALLOWED_LICENSES.has(entry.license) || DISALLOWED_LICENSE_PATTERN.test(entry.license)) {
        errors.push(`${ctx}: license "${entry.license}" is not in the permissive allowlist`);
      }
    }
  }

  if (diskAssetSet instanceof Set) {
    for (const diskPath of diskAssetSet) {
      if (!seenPaths.has(diskPath)) {
        errors.push(`ATTRIBUTION.json missing provenance entry for "${diskPath}"`);
      }
    }
    for (const attrPath of seenPaths) {
      if (!diskAssetSet.has(attrPath)) {
        errors.push(`ATTRIBUTION.json references non-existent asset "${attrPath}"`);
      }
    }
  }

  return errors;
}

function collectFilesRecursive(dirAbs, baseRoot, outSet) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(full, baseRoot, outSet);
    } else if (entry.isFile()) {
      outSet.add(toPosix(path.relative(baseRoot, full)));
    }
  }
}

function validateAssets(baseDir) {
  const root = baseDir || ROOT;
  const errors = [];
  const manifestPath = path.join(root, "assets", "manifest.json");
  const attributionPath = path.join(root, "assets", "ATTRIBUTION.json");

  if (!fs.existsSync(manifestPath)) {
    errors.push("Missing assets/manifest.json");
  }
  if (!fs.existsSync(attributionPath)) {
    errors.push("Missing assets/ATTRIBUTION.json");
  }
  if (errors.length > 0) {
    return {
      errors,
      summary: {
        domainCount: 0,
        activeDomains: [],
        itemCount: 0,
        sfxCount: 0,
        promptCount: 0,
        diskAssetCount: 0,
        attributionCount: 0,
      },
    };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const attribution = JSON.parse(fs.readFileSync(attributionPath, "utf8"));

  if (manifest.schema_version !== 1) {
    errors.push(`assets/manifest.json schema_version must be 1 (got ${manifest.schema_version})`);
  }

  const domainsObj = manifest.domains && typeof manifest.domains === "object" ? manifest.domains : {};
  const domainKeys = Object.keys(domainsObj);
  for (const d of CANONICAL_DOMAINS) {
    if (!domainsObj[d]) {
      errors.push(`assets/manifest.json missing canonical domain "${d}"`);
    }
  }

  const activeDomains = Array.isArray(manifest.active_domains) ? manifest.active_domains : [];
  if (activeDomains.length === 0) {
    errors.push("assets/manifest.json active_domains must be a non-empty array");
  }

  // Validate SFX
  const sfxObj = manifest.sfx && typeof manifest.sfx === "object" ? manifest.sfx : {};
  for (const key of REQUIRED_SFX) {
    const entry = sfxObj[key];
    if (!entry) {
      errors.push(`assets/manifest.json missing required SFX "${key}"`);
      continue;
    }
    if (entry.non_verbal !== true) {
      errors.push(`SFX "${key}" must declare non_verbal: true`);
    }
    const abs = path.join(root, entry.path || "");
    errors.push(
      ...validateAudioFile(abs, { maxBytes: MAX_SFX_AUDIO_BYTES, label: `sfx:${key}` })
    );
  }

  // Validate Prompts
  const promptsObj = manifest.prompts && typeof manifest.prompts === "object" ? manifest.prompts : {};
  for (const key of REQUIRED_PROMPTS) {
    const entry = promptsObj[key];
    if (!entry) {
      errors.push(`assets/manifest.json missing required prompt "${key}"`);
      continue;
    }
    if (typeof entry.text !== "string" || entry.text.trim() === "") {
      errors.push(`Prompt "${key}" must include non-empty text`);
    }
    const abs = path.join(root, entry.path || "");
    errors.push(
      ...validateAudioFile(abs, { maxBytes: MAX_ITEM_AUDIO_BYTES, label: `prompt:${key}` })
    );
  }

  // Validate active vertical slice items against preschool-curriculum/core/<domain>.json
  const itemsObj = manifest.items && typeof manifest.items === "object" ? manifest.items : {};
  let verifiedItemCount = 0;

  for (const domain of activeDomains) {
    const coreFile = path.join(root, "preschool-curriculum", "core", `${domain}.json`);
    if (!fs.existsSync(coreFile)) {
      errors.push(`Active domain "${domain}" has no curriculum file at preschool-curriculum/core/${domain}.json`);
      continue;
    }
    const coreData = JSON.parse(fs.readFileSync(coreFile, "utf8"));
    for (const item of coreData.items || []) {
      const entry = itemsObj[item.id];
      if (!entry) {
        errors.push(`Manifest missing asset entry for active core item "${item.id}" (${domain})`);
        continue;
      }
      verifiedItemCount++;

      if (entry.domain !== domain) {
        errors.push(`Item "${item.id}" domain mismatch: expected "${domain}", got "${entry.domain}"`);
      }
      if (typeof entry.spoken_text !== "string" || entry.spoken_text.trim() === "") {
        errors.push(`Item "${item.id}" missing non-empty spoken_text`);
      }

      const audioAbs = path.join(root, entry.audio || "");
      errors.push(
        ...validateAudioFile(audioAbs, { maxBytes: MAX_ITEM_AUDIO_BYTES, label: `item:${item.id}` })
      );

      if (!entry.visual || typeof entry.visual !== "object") {
        errors.push(`Item "${item.id}" missing visual definition`);
      } else {
        if (typeof entry.visual.renderer !== "string" || entry.visual.renderer.trim() === "") {
          errors.push(`Item "${item.id}" visual missing renderer type`);
        }
        if (entry.visual.svg) {
          const svgAbs = path.join(root, entry.visual.svg);
          errors.push(...validateSvgFile(svgAbs, { label: `svg:${item.id}` }));
        } else {
          errors.push(`Item "${item.id}" visual missing svg file path`);
        }
      }
    }
  }

  // Verify 100% ATTRIBUTION.json coverage for all files under assets/audio and assets/visuals
  const diskAssets = new Set();
  collectFilesRecursive(path.join(root, "assets", "audio"), root, diskAssets);
  collectFilesRecursive(path.join(root, "assets", "visuals"), root, diskAssets);
  errors.push(...validateAttribution(attribution, diskAssets));

  return {
    errors,
    summary: {
      domainCount: domainKeys.length,
      activeDomains,
      itemCount: verifiedItemCount,
      sfxCount: Object.keys(sfxObj).length,
      promptCount: Object.keys(promptsObj).length,
      diskAssetCount: diskAssets.size,
      attributionCount: Array.isArray(attribution.assets) ? attribution.assets.length : 0,
    },
  };
}

if (require.main === module) {
  const result = validateAssets(ROOT);
  if (result.errors.length > 0) {
    console.error("ASSET VALIDATION FAILED:");
    for (const err of result.errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  }
  const s = result.summary;
  console.log(
    `ASSET VALIDATION PASSED | domains=${s.domainCount}, active=${s.activeDomains.join(",")}, items=${s.itemCount}, sfx=${s.sfxCount}, prompts=${s.promptCount}, attributed=${s.attributionCount}`
  );
}

module.exports = {
  CANONICAL_DOMAINS,
  REQUIRED_SFX,
  REQUIRED_PROMPTS,
  IOS_SAFARI_AUDIO_EXTS,
  ALLOWED_LICENSES,
  validateAudioFile,
  validateSvgFile,
  validateAttribution,
  validateAssets,
};
