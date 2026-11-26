#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CURRICULUM_CORE_DIR = path.join(ROOT, "preschool-curriculum", "core");
const ASSETS_DIR = path.join(ROOT, "assets");

const SAMPLE_RATE = 16000;

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

const ACTIVE_DOMAINS = ["02_numbers_quantities", "05_colors_measurement"];

const PROMPT_DEFS = {
  hint_try_saying: "Try saying",
  calib_say_hi: "Say hi to test your microphone!",
  calib_great_job: "Great job! Your microphone is ready.",
  round_start: "Let's play!",
  try_again_gentle: "Almost! Let's try again.",
};

const COLOR_HEX = {
  "color-red": { hex: "#E63946", stroke: "#9B1C26" },
  "color-blue": { hex: "#2563EB", stroke: "#1E3A8A" },
  "color-yellow": { hex: "#FACC15", stroke: "#A16207" },
  "color-green": { hex: "#16A34A", stroke: "#14532D" },
  "color-orange": { hex: "#F97316", stroke: "#9A3412" },
  "color-purple": { hex: "#9333EA", stroke: "#581C87" },
  "color-pink": { hex: "#EC4899", stroke: "#9D174D" },
  "color-brown": { hex: "#8B5A2B", stroke: "#4A2C11" },
  "color-black": { hex: "#1F2937", stroke: "#030712" },
  "color-white": { hex: "#FFFFFF", stroke: "#475569" },
  "color-gray": { hex: "#94A3B8", stroke: "#475569" },
};

const NUMERAL_PALETTE = [
  "#2563EB",
  "#E63946",
  "#16A34A",
  "#F97316",
  "#9333EA",
  "#0D9488",
  "#DB2777",
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function encodeWavMono16(samples, sampleRate) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

function synthesizeSfxSamples(kind) {
  if (kind === "bop") {
    const dur = 0.18;
    const n = Math.floor(SAMPLE_RATE * dur);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const frac = t / dur;
      const freq = 520 - 300 * Math.pow(frac, 0.7);
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = Math.min(1, t / 0.008) * Math.exp(-16 * t);
      out[i] = 0.75 * env * (Math.sin(phase) + 0.35 * Math.sin(phase * 2));
    }
    return { samples: out, durationMs: Math.round(dur * 1000) };
  }

  if (kind === "pop_up") {
    const dur = 0.16;
    const n = Math.floor(SAMPLE_RATE * dur);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const frac = t / dur;
      const freq = 260 + 380 * frac;
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = Math.min(1, t / 0.01) * Math.sin(Math.PI * Math.min(1, frac));
      out[i] = 0.7 * env * Math.sin(phase);
    }
    return { samples: out, durationMs: Math.round(dur * 1000) };
  }

  if (kind === "duck_down") {
    const dur = 0.18;
    const n = Math.floor(SAMPLE_RATE * dur);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const frac = t / dur;
      const freq = 440 - 250 * frac;
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = Math.min(1, t / 0.01) * (1 - frac);
      out[i] = 0.65 * env * Math.sin(phase);
    }
    return { samples: out, durationMs: Math.round(dur * 1000) };
  }

  // round_win: cheerful C5-E5-G5-C6 arpeggio
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const noteDur = 0.14;
  const tailDur = 0.16;
  const totalDur = notes.length * noteDur + tailDur;
  const n = Math.floor(SAMPLE_RATE * totalDur);
  const out = new Float32Array(n);
  for (let idx = 0; idx < notes.length; idx++) {
    const start = Math.floor(idx * noteDur * SAMPLE_RATE);
    const len = Math.floor((noteDur + tailDur) * SAMPLE_RATE);
    const freq = notes[idx];
    for (let j = 0; j < len && start + j < n; j++) {
      const t = j / SAMPLE_RATE;
      const env = Math.min(1, t / 0.01) * Math.exp(-7 * t);
      out[start + j] += 0.45 * env * (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t));
    }
  }
  return { samples: out, durationMs: Math.round(totalDur * 1000) };
}

function trimWavSilence(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length <= 44 || buf.slice(0, 4).toString("ascii") !== "RIFF") return;
  const dataOffset = buf.indexOf(Buffer.from("data", "ascii"), 12);
  if (dataOffset === -1 || dataOffset + 8 > buf.length) return;
  const dataLen = buf.readUInt32LE(dataOffset + 4);
  const pcmStart = dataOffset + 8;
  const sampleCount = Math.floor(Math.min(dataLen, buf.length - pcmStart) / 2);
  if (sampleCount < 160) return;

  const threshold = 220;
  let first = 0;
  while (first < sampleCount && Math.abs(buf.readInt16LE(pcmStart + first * 2)) < threshold) {
    first++;
  }
  let last = sampleCount - 1;
  while (last > first && Math.abs(buf.readInt16LE(pcmStart + last * 2)) < threshold) {
    last--;
  }

  const pad = Math.floor(SAMPLE_RATE * 0.04); // 40ms breathing room
  const startIdx = Math.max(0, first - pad);
  const endIdx = Math.min(sampleCount - 1, last + pad);
  if (endIdx <= startIdx + 80) return;

  const trimmed = new Float32Array(endIdx - startIdx + 1);
  for (let i = 0; i < trimmed.length; i++) {
    trimmed[i] = buf.readInt16LE(pcmStart + (startIdx + i) * 2) / 32768;
  }
  fs.writeFileSync(absPath, encodeWavMono16(trimmed, SAMPLE_RATE));
}

function readWavDurationMs(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 44) return 0;
  const byteRate = buf.readUInt32LE(28) || SAMPLE_RATE * 2;
  const dataOffset = buf.indexOf(Buffer.from("data", "ascii"), 12);
  const dataLen = dataOffset !== -1 ? buf.readUInt32LE(dataOffset + 4) : buf.length - 44;
  return Math.round((dataLen / byteRate) * 1000);
}

function synthesizeSpeechBatch(jobs) {
  let usedSapi = false;

  if (process.platform === "win32") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apps4kids-sapi-"));
    const jobsJsonPath = path.join(tmpDir, "jobs.json");
    const psScriptPath = path.join(tmpDir, "synth.ps1");
    try {
      fs.writeFileSync(jobsJsonPath, JSON.stringify(jobs, null, 2), "utf8");
      const psScript = [
        "Add-Type -AssemblyName System.Speech",
        "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
        "$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }",
        "$preferred = $voices | Where-Object { $_.VoiceInfo.Name -match 'Zira|Aria|Jenny|Eva' } | Select-Object -First 1",
        "if ($preferred) { $synth.SelectVoice($preferred.VoiceInfo.Name) }",
        "$synth.Rate = -1",
        "$synth.Volume = 100",
        "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
        `$jobs = Get-Content -Raw -Path '${jobsJsonPath.replace(/'/g, "''")}' | ConvertFrom-Json`,
        "foreach ($j in $jobs) {",
        "  $synth.SetOutputToWaveFile($j.outPath, $fmt)",
        "  $synth.Speak($j.text)",
        "}",
        "$synth.SetOutputToNull()",
        "$synth.Dispose()",
      ].join("\r\n");
      fs.writeFileSync(psScriptPath, psScript, "utf8");
      execFileSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psScriptPath],
        { stdio: "inherit" }
      );
      usedSapi = true;
    } catch (err) {
      console.warn(`Windows SAPI synthesis failed (${err.message}); using procedural tone fallback.`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (usedSapi && fs.existsSync(job.outPath) && fs.statSync(job.outPath).size > 44) {
      trimWavSilence(job.outPath);
    } else {
      // Deterministic offline fallback chime if SAPI is unavailable
      const dur = 0.25;
      const n = Math.floor(SAMPLE_RATE * dur);
      const samples = new Float32Array(n);
      const freq = 330 + (i % 12) * 28;
      for (let s = 0; s < n; s++) {
        const t = s / SAMPLE_RATE;
        const env = Math.min(1, t / 0.015) * Math.exp(-8 * t);
        samples[s] = 0.55 * env * Math.sin(2 * Math.PI * freq * t);
      }
      fs.writeFileSync(job.outPath, encodeWavMono16(samples, SAMPLE_RATE));
    }
  }

  return usedSapi ? "offline_sapi_tts_poc_placeholder" : "procedural_tone_fallback";
}

function extractSpokenText(item) {
  if (Array.isArray(item.accepted_utterances) && item.accepted_utterances.length > 0) {
    return item.accepted_utterances[0];
  }
  const clean = String(item.label || item.id)
    .replace(/\bvs\.?\b/gi, "and")
    .replace(/[\/|]/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
  return clean;
}

function extractTrailingInt(id) {
  const m = String(id).match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function buildNumberSvg(item) {
  const id = item.id;
  if (id.startsWith("num-digit-")) {
    const n = extractTrailingInt(id);
    const fill = NUMERAL_PALETTE[n % NUMERAL_PALETTE.length];
    const fontSize = n >= 10 ? 116 : 138;
    return {
      renderer: "programmatic_numeral",
      params: { value: n, color: fill },
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
        '  <rect x="16" y="16" width="208" height="208" rx="36" fill="#FFFDF7" stroke="' + fill + '" stroke-width="10"/>',
        '  <text x="120" y="164" text-anchor="middle" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="800" font-size="' + fontSize + '" fill="' + fill + '">' + n + "</text>",
        "</svg>",
      ].join("\n"),
    };
  }

  if (id.startsWith("qty-dice-")) {
    const n = Math.max(1, Math.min(6, extractTrailingInt(id)));
    const pipCoords = {
      1: [[120, 120]],
      2: [[74, 74], [166, 166]],
      3: [[74, 74], [120, 120], [166, 166]],
      4: [[74, 74], [166, 74], [74, 166], [166, 166]],
      5: [[74, 74], [166, 74], [120, 120], [74, 166], [166, 166]],
      6: [[74, 68], [166, 68], [74, 120], [166, 120], [74, 172], [166, 172]],
    }[n];
    const pips = pipCoords
      .map(([cx, cy]) => `  <circle cx="${cx}" cy="${cy}" r="18" fill="#1E293B"/>`)
      .join("\n");
    return {
      renderer: "programmatic_dice",
      params: { value: n },
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
        '  <rect x="24" y="24" width="192" height="192" rx="34" fill="#FFFFFF" stroke="#1E293B" stroke-width="10"/>',
        pips,
        "</svg>",
      ].join("\n"),
    };
  }

  if (id.startsWith("qty-fiveframe-") || id.startsWith("qty-tenframe-")) {
    const isTen = id.startsWith("qty-tenframe-");
    const n = extractTrailingInt(id);
    const rows = isTen ? 2 : 1;
    const cols = 5;
    const cell = 38;
    const startX = 25;
    const startY = isTen ? 82 : 101;
    const cells = [];
    const dots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * cell;
        const y = startY + r * cell;
        cells.push(`  <rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="#FFFFFF" stroke="#334155" stroke-width="4"/>`);
        const idx = r * cols + c;
        if (idx < n) {
          dots.push(`  <circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="12" fill="#E63946"/>`);
        }
      }
    }
    return {
      renderer: isTen ? "programmatic_ten_frame" : "programmatic_five_frame",
      params: { value: n, slots: rows * cols },
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
        '  <rect x="12" y="12" width="216" height="216" rx="28" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="6"/>',
        ...cells,
        ...dots,
        "</svg>",
      ].join("\n"),
    };
  }

  if (id.startsWith("qty-tally-")) {
    const n = extractTrailingInt(id);
    const strokes = [];
    const groups = Math.ceil(Math.max(1, n) / 5);
    const startX = groups === 1 ? 82 : 34;
    for (let i = 0; i < n; i++) {
      const g = Math.floor(i / 5);
      const pos = i % 5;
      const gx = startX + g * 96;
      if (pos < 4) {
        const x = gx + pos * 18;
        strokes.push(`  <line x1="${x}" y1="70" x2="${x}" y2="170" stroke="#1E293B" stroke-width="10" stroke-linecap="round"/>`);
      } else {
        strokes.push(`  <line x1="${gx - 8}" y1="158" x2="${gx + 62}" y2="82" stroke="#E63946" stroke-width="10" stroke-linecap="round"/>`);
      }
    }
    return {
      renderer: "programmatic_tally",
      params: { value: n },
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
        '  <rect x="16" y="16" width="208" height="208" rx="32" fill="#FFFDF7" stroke="#CBD5E1" stroke-width="6"/>',
        ...strokes,
        "</svg>",
      ].join("\n"),
    };
  }

  if (id.startsWith("qty-fingers-")) {
    const n = extractTrailingInt(id);
    const leftCount = Math.min(5, n);
    const rightCount = Math.max(0, n - 5);
    const drawHand = (cx, count) => {
      const parts = [
        `  <rect x="${cx - 34}" y="122" width="68" height="66" rx="22" fill="#FDBA74" stroke="#9A3412" stroke-width="5"/>`,
      ];
      for (let f = 0; f < count; f++) {
        const fx = cx - 28 + f * 14;
        const fh = f === 0 ? 34 : 52;
        const fy = 124 - fh;
        parts.push(`  <rect x="${fx}" y="${fy}" width="11" height="${fh + 8}" rx="5" fill="#FDBA74" stroke="#9A3412" stroke-width="4"/>`);
      }
      return parts.join("\n");
    };
    const hands =
      n <= 5 ? drawHand(120, leftCount) : `${drawHand(72, leftCount)}\n${drawHand(168, rightCount)}`;
    return {
      renderer: "programmatic_fingers",
      params: { value: n },
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
        '  <rect x="16" y="16" width="208" height="208" rx="32" fill="#EFF6FF" stroke="#93C5FD" stroke-width="6"/>',
        hands,
        "</svg>",
      ].join("\n"),
    };
  }

  // Ordinals (1st, 2nd, 3rd)
  const ordIdx = id.includes("1st") ? 0 : id.includes("2nd") ? 1 : 2;
  const stars = [60, 120, 180].map((cx, i) => {
    const active = i === ordIdx;
    const fill = active ? "#FACC15" : "#E2E8F0";
    const stroke = active ? "#B45309" : "#94A3B8";
    const r = active ? 28 : 20;
    return `  <circle cx="${cx}" cy="120" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="6"/>`;
  });
  return {
    renderer: "programmatic_ordinal",
    params: { position: ordIdx + 1 },
    svg: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
      '  <rect x="16" y="16" width="208" height="208" rx="32" fill="#FFFDF7" stroke="#CBD5E1" stroke-width="6"/>',
      ...stars,
      "</svg>",
    ].join("\n"),
  };
}

function buildColorOrMeasurementSvg(item) {
  const id = item.id;
  if (COLOR_HEX[id]) {
    const { hex, stroke } = COLOR_HEX[id];
    return {
      renderer: "programmatic_color_swatch",
      params: { hex, stroke },
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
        '  <rect x="16" y="16" width="208" height="208" rx="36" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="6"/>',
        `  <circle cx="120" cy="120" r="76" fill="${hex}" stroke="${stroke}" stroke-width="10"/>`,
        '  <circle cx="94" cy="92" r="18" fill="#FFFFFF" fill-opacity="0.35"/>',
        "</svg>",
      ].join("\n"),
    };
  }

  // Measurement / contrast pair visual (non-text side-by-side comparison shapes)
  const pairColorA = "#2563EB";
  const pairColorB = "#F97316";
  let leftShape = `  <circle cx="72" cy="124" r="42" fill="${pairColorA}"/>`;
  let rightShape = `  <circle cx="172" cy="144" r="20" fill="${pairColorB}"/>`;

  if (id.includes("tall-short") || id.includes("high-low")) {
    leftShape = `  <rect x="50" y="48" width="44" height="148" rx="10" fill="${pairColorA}"/>`;
    rightShape = `  <rect x="146" y="128" width="44" height="68" rx="10" fill="${pairColorB}"/>`;
  } else if (id.includes("long-short") || id.includes("wide-narrow") || id.includes("thick-thin")) {
    leftShape = `  <rect x="36" y="76" width="168" height="32" rx="12" fill="${pairColorA}"/>`;
    rightShape = `  <rect x="36" y="138" width="76" height="32" rx="12" fill="${pairColorB}"/>`;
  } else if (id.includes("full-empty")) {
    leftShape = `  <rect x="44" y="64" width="58" height="120" rx="10" fill="${pairColorA}" stroke="#1E293B" stroke-width="6"/>`;
    rightShape = `  <rect x="138" y="64" width="58" height="120" rx="10" fill="#FFFFFF" stroke="#1E293B" stroke-width="6"/>`;
  } else if (id.includes("hot-cold")) {
    leftShape = '  <circle cx="72" cy="120" r="36" fill="#EF4444" stroke="#FACC15" stroke-width="8"/>';
    rightShape = '  <rect x="142" y="90" width="60" height="60" rx="12" fill="#38BDF8" stroke="#0284C7" stroke-width="8"/>';
  } else if (id.includes("same-different")) {
    leftShape = `  <circle cx="72" cy="120" r="34" fill="${pairColorA}"/>`;
    rightShape = `  <rect x="138" y="86" width="68" height="68" rx="8" fill="${pairColorB}"/>`;
  }

  return {
    renderer: "programmatic_measurement_pair",
    params: { pair_id: id },
    svg: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">',
      '  <rect x="14" y="14" width="212" height="212" rx="30" fill="#FFFDF7" stroke="#CBD5E1" stroke-width="6"/>',
      '  <line x1="120" y1="32" x2="120" y2="208" stroke="#CBD5E1" stroke-width="4" stroke-dasharray="8 8"/>',
      leftShape,
      rightShape,
      "</svg>",
    ].join("\n"),
  };
}

function run() {
  const sfxDir = path.join(ASSETS_DIR, "audio", "sfx");
  const promptsDir = path.join(ASSETS_DIR, "audio", "prompts");
  ensureDir(sfxDir);
  ensureDir(promptsDir);

  const attributionEntries = [];
  const manifest = {
    schema_version: 1,
    active_domains: ACTIVE_DOMAINS,
    audio_budget: {
      ios_safari_formats: [".wav", ".mp3", ".m4a"],
      item_max_bytes: 262144,
      sfx_max_bytes: 131072,
    },
    domains: {},
    sfx: {},
    prompts: {},
    items: {},
  };

  for (const domain of CANONICAL_DOMAINS) {
    const active = ACTIVE_DOMAINS.includes(domain);
    manifest.domains[domain] = {
      status: active ? "populated" : "planned",
      audio_dir: `assets/audio/items/${domain}`,
      visuals_dir: `assets/visuals/${domain}`,
    };
  }

  // 1. Generate 4 non-verbal SFX
  const sfxSpecs = [
    { key: "bop", title: "Soft Cartoon Bop", description: "Instant non-verbal mole-bop feedback" },
    { key: "pop_up", title: "Mole Pop-Up Chirp", description: "Rising non-verbal mole spawn cue" },
    { key: "duck_down", title: "Mole Duck-Down Slide", description: "Gentle non-verbal mole retreat cue" },
    { key: "round_win", title: "Round Win Chime", description: "Cheerful non-verbal major-triad win chime" },
  ];
  for (const spec of sfxSpecs) {
    const rel = `assets/audio/sfx/${spec.key}.wav`;
    const abs = path.join(ROOT, rel);
    const { samples, durationMs } = synthesizeSfxSamples(spec.key);
    fs.writeFileSync(abs, encodeWavMono16(samples, SAMPLE_RATE));
    manifest.sfx[spec.key] = {
      path: rel,
      format: "wav",
      duration_ms: durationMs,
      non_verbal: true,
      description: spec.description,
    };
    attributionEntries.push({
      path: rel,
      title: spec.title,
      author: "kentch2013",
      source_url: "original",
      license: "Original",
      license_url: "LICENSE",
      creation_method: "procedural_pcm_synthesis",
      commercial_terms_verified: true,
      notes: "Procedural 16kHz 16-bit mono PCM non-verbal SFX generated by scripts/generate-assets.js",
    });
  }

  // 2. Collect all speech jobs (prompts + active domain core items) and generate SVGs
  const speechJobs = [];
  for (const [key, text] of Object.entries(PROMPT_DEFS)) {
    const rel = `assets/audio/prompts/${key}.wav`;
    const abs = path.join(ROOT, rel);
    speechJobs.push({ kind: "prompt", key, text, rel, outPath: abs });
  }

  for (const domain of ACTIVE_DOMAINS) {
    ensureDir(path.join(ASSETS_DIR, "audio", "items", domain));
    ensureDir(path.join(ASSETS_DIR, "visuals", domain));

    const corePath = path.join(CURRICULUM_CORE_DIR, `${domain}.json`);
    const coreData = JSON.parse(fs.readFileSync(corePath, "utf8"));

    for (const item of coreData.items) {
      const spokenText = extractSpokenText(item);
      const audioRel = `assets/audio/items/${domain}/${item.id}.wav`;
      const audioAbs = path.join(ROOT, audioRel);
      speechJobs.push({
        kind: "item",
        domain,
        id: item.id,
        label: item.label || item.id,
        text: spokenText,
        rel: audioRel,
        outPath: audioAbs,
      });

      const visualRel = `assets/visuals/${domain}/${item.id}.svg`;
      const visualAbs = path.join(ROOT, visualRel);
      const visualSpec =
        domain === "02_numbers_quantities"
          ? buildNumberSvg(item)
          : buildColorOrMeasurementSvg(item);
      fs.writeFileSync(visualAbs, visualSpec.svg + "\n", "utf8");

      manifest.items[item.id] = {
        domain,
        spoken_text: spokenText,
        audio: audioRel,
        visual: {
          renderer: visualSpec.renderer,
          params: visualSpec.params,
          svg: visualRel,
        },
      };

      attributionEntries.push({
        path: visualRel,
        title: `${item.label || item.id} Visual`,
        author: "kentch2013",
        source_url: "original",
        license: "Original",
        license_url: "LICENSE",
        creation_method: "procedural_svg_generator",
        commercial_terms_verified: true,
        notes: "Offline vector graphic generated by scripts/generate-assets.js",
      });
    }
  }

  // 3. Batch synthesize all prerecorded spoken audio clips
  const speechMethod = synthesizeSpeechBatch(speechJobs);

  for (const job of speechJobs) {
    const durMs = readWavDurationMs(job.outPath);
    if (job.kind === "prompt") {
      manifest.prompts[job.key] = {
        path: job.rel,
        text: job.text,
        format: "wav",
        duration_ms: durMs,
      };
    }
    attributionEntries.push({
      path: job.rel,
      title: job.kind === "prompt" ? `Prompt: ${job.key}` : `Spoken Clip: ${job.label}`,
      author: "kentch2013",
      source_url: "original",
      license: "Original",
      license_url: "LICENSE",
      creation_method: speechMethod,
      commercial_terms_verified: speechMethod !== "offline_sapi_tts_poc_placeholder",
      notes:
        speechMethod === "offline_sapi_tts_poc_placeholder"
          ? "Offline Windows SAPI TTS placeholder for browser PoC; replace with human/CC0 voice recordings before App Store release"
          : "Offline procedural fallback clip generated by scripts/generate-assets.js",
    });
  }

  attributionEntries.sort((a, b) => a.path.localeCompare(b.path));

  fs.writeFileSync(
    path.join(ASSETS_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(ASSETS_DIR, "ATTRIBUTION.json"),
    JSON.stringify({ schema_version: 1, assets: attributionEntries }, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `GENERATED ASSETS | items=${Object.keys(manifest.items).length}, prompts=${Object.keys(manifest.prompts).length}, sfx=${Object.keys(manifest.sfx).length}, attribution=${attributionEntries.length}, speechMethod=${speechMethod}`
  );
}

if (require.main === module) {
  run();
}

module.exports = { run };
