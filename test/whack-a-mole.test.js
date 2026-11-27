#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WEB_POC_DIR = path.join(ROOT, "web-poc");
const launcher = require(path.join(WEB_POC_DIR, "launcher.js"));
const engineMod = require(path.join(WEB_POC_DIR, "games", "whack-a-mole", "engine.js"));
const voiceMatcher = require(path.join(WEB_POC_DIR, "shared", "voice-matcher.js"));

// 1. Exports contract
assert.strictEqual(typeof launcher.getEligibleGames, "function");
assert.strictEqual(typeof launcher.getEligibleSkills, "function");
assert.strictEqual(typeof launcher.buildSessionConfig, "function");
assert.strictEqual(typeof engineMod.createWhackAMoleEngine, "function");
assert.strictEqual(typeof engineMod.isConfusablePair, "function");
assert.strictEqual(typeof engineMod.filterItemsForSession, "function");
assert.ok(engineMod.TIER_CONFIG && engineMod.TIER_CONFIG[1] && engineMod.TIER_CONFIG[4]);

// 2. Two-way manifest-driven launcher flows (Skill -> Games & Game -> Skills)
{
  const manifestPath = path.join(WEB_POC_DIR, "games.manifest.json");
  assert.ok(fs.existsSync(manifestPath), "Missing web-poc/games.manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.strictEqual(manifest.schema_version, 1);

  // Path A: Skill -> Games
  const gamesForNumbers = launcher.getEligibleGames(manifest, ["02_numbers_quantities"], 1);
  assert.strictEqual(gamesForNumbers.length, 1);
  assert.strictEqual(gamesForNumbers[0].id, "whack-a-mole");

  const gamesForBoth = launcher.getEligibleGames(
    manifest,
    ["02_numbers_quantities", "05_colors_measurement"],
    2
  );
  assert.strictEqual(gamesForBoth.length, 1);

  const gamesForInactive = launcher.getEligibleGames(manifest, ["01_letters"], 1);
  assert.strictEqual(gamesForInactive.length, 0, "Inactive domains must return no eligible games");

  // Path B: Game -> Skills
  const skills = launcher.getEligibleSkills(manifest, "whack-a-mole");
  assert.deepStrictEqual(
    skills.domains.map((d) => d.id).sort(),
    ["02_numbers_quantities", "05_colors_measurement"]
  );
  assert.deepStrictEqual(skills.tiers, [1, 2, 3, 4]);

  // Session config validation
  const cfg = launcher.buildSessionConfig(manifest, {
    gameId: "whack-a-mole",
    domains: ["02_numbers_quantities", "05_colors_measurement"],
    tier: 1,
  });
  assert.strictEqual(cfg.gameId, "whack-a-mole");
  assert.strictEqual(cfg.tier, 1);
  assert.strictEqual(cfg.domains.length, 2);
}

// 3. Difficulty tier timer & concurrency scaling
{
  const t1 = engineMod.TIER_CONFIG[1];
  const t2 = engineMod.TIER_CONFIG[2];
  const t3 = engineMod.TIER_CONFIG[3];
  const t4 = engineMod.TIER_CONFIG[4];
  assert.ok(t1.dwellMs > t2.dwellMs, "Tier 1 dwell time must be more lenient than Tier 2");
  assert.ok(t2.dwellMs > t3.dwellMs, "Tier 2 dwell time must be more lenient than Tier 3");
  assert.ok(t3.dwellMs > t4.dwellMs, "Tier 3 dwell time must be more lenient than Tier 4");
  assert.ok(t1.maxSimultaneousMoles <= t3.maxSimultaneousMoles, "Concurrency scales with tier");
  assert.strictEqual(t1.maxRetriesBeforeHint, 2, "Default retries before gentle hint must be 2");
}

// 4. Anti-confusion spawner: explicit confusable_with AND dynamic utterance-overlap exclusion
{
  const itemA = {
    id: "num-digit-1",
    tier: 1,
    accepted_utterances: ["one", "1"],
    confusable_with: ["num-digit-7"],
  };
  const itemB = {
    id: "num-digit-7",
    tier: 1,
    accepted_utterances: ["seven", "7"],
    confusable_with: [],
  };
  const itemOrd1 = {
    id: "num-ordinal-1st",
    tier: 3,
    accepted_utterances: ["first", "one"],
    confusable_with: [],
  };
  const itemColorRed = {
    id: "color-red",
    tier: 1,
    accepted_utterances: ["red"],
    confusable_with: [],
  };

  assert.strictEqual(
    engineMod.isConfusablePair(itemA, itemB),
    true,
    "Symmetric confusable_with must block co-spawning"
  );
  assert.strictEqual(
    engineMod.isConfusablePair(itemB, itemA),
    true,
    "Reverse confusable_with lookup must also block co-spawning"
  );
  assert.strictEqual(
    engineMod.isConfusablePair(itemA, itemOrd1),
    true,
    "Dynamic utterance overlap ('one') must block co-spawning even without confusable_with"
  );
  assert.strictEqual(
    engineMod.isConfusablePair(itemA, itemColorRed),
    false,
    "Non-confusable items with disjoint utterances must be allowed together"
  );

  // Engine with ONLY two mutually confusable items must never spawn both simultaneously
  const confusableEngine = engineMod.createWhackAMoleEngine({
    items: [itemA, itemOrd1],
    tier: 1,
    voiceMatcher,
    rng: () => 0,
  });
  confusableEngine.start(1000);
  confusableEngine.tick(1000);
  confusableEngine.tick(5000);
  assert.strictEqual(
    confusableEngine.getState().activeMoles.length,
    1,
    "Spawner must not co-spawn utterance-overlapping items"
  );
}

// 5. Multi-mole matching in ANY order + non-verbal bop SFX
{
  const pool = [
    { id: "color-red", tier: 1, accepted_utterances: ["red"], confusable_with: [] },
    { id: "num-digit-3", tier: 1, accepted_utterances: ["three", "tree"], confusable_with: [] },
    { id: "color-blue", tier: 1, accepted_utterances: ["blue"], confusable_with: [] },
  ];
  const eng = engineMod.createWhackAMoleEngine({
    items: pool,
    tier: 1,
    voiceMatcher,
    roundTargetBops: 4,
    rng: () => 0,
  });
  eng.start(0);
  eng.tick(0);
  eng.tick(2500);
  const active = eng.getState().activeMoles;
  assert.strictEqual(active.length, 2, "Tier 1 should spawn up to 2 simultaneous moles");

  // Name the SECOND spawned mole first (any-order bopping)
  const secondMole = active[1];
  const firstMole = active[0];
  const res1 = eng.handleUtterance(secondMole.item.accepted_utterances[0], { nowMs: 2600 });
  assert.strictEqual(res1.action, "bop");
  assert.strictEqual(res1.mole.itemId, secondMole.itemId);
  assert.strictEqual(res1.sfx, "bop", "Instant bop must trigger non-verbal 'bop' SFX");
  assert.strictEqual(eng.getState().bops, 1);

  // First mole must still be active and boppable next
  const stillThere = eng.getState().activeMoles.find((m) => m.itemId === firstMole.itemId);
  assert.ok(stillThere, "Other active mole must remain active after bopping a different mole");
  const res2 = eng.handleUtterance(firstMole.item.accepted_utterances[0], { nowMs: 2800 });
  assert.strictEqual(res2.action, "bop");
  assert.strictEqual(res2.mole.itemId, firstMole.itemId);
  assert.strictEqual(eng.getState().bops, 2);
}

// 6. 2-Retry -> Gentle Hint state machine + Mic-Gated self-bop protection
{
  const pool = [
    { id: "color-yellow", tier: 1, accepted_utterances: ["yellow"], confusable_with: [] },
    { id: "num-digit-5", tier: 1, accepted_utterances: ["five"], confusable_with: [] },
  ];
  const eng = engineMod.createWhackAMoleEngine({
    items: pool,
    tier: 1,
    voiceMatcher,
    rng: () => 0,
  });
  eng.start(1000);
  eng.tick(1000);
  eng.tick(3500);

  const oldest = eng.getState().activeMoles[0];
  const origDeadline = oldest.expiresAtMs;

  // Retry 1
  const r1 = eng.handleUtterance("banana", { nowMs: 4000 });
  assert.strictEqual(r1.action, "retry");
  assert.strictEqual(eng.getState().unrecognizedCount, 1);
  assert.strictEqual(eng.getState().micGated, false);

  // Retry 2 -> triggers gentle hint for oldest active mole & gates mic
  const r2 = eng.handleUtterance("elephant", { nowMs: 4500 });
  assert.strictEqual(r2.action, "hint");
  assert.strictEqual(r2.mole.itemId, oldest.itemId, "Hint must target oldest active mole");
  assert.deepStrictEqual(r2.audioSequence, ["prompt:hint_try_saying", `item:${oldest.itemId}`]);
  assert.strictEqual(eng.getState().micGated, true, "Mic must be gated during hint playback");
  assert.strictEqual(eng.getState().unrecognizedCount, 0);
  assert.ok(
    eng.getState().activeMoles[0].expiresAtMs > origDeadline,
    "Hint must grant grace time on oldest mole"
  );

  // Speaker echo while mic is gated must NOT trigger self-bop
  const echo = eng.handleUtterance(oldest.item.accepted_utterances[0], { nowMs: 4700 });
  assert.strictEqual(echo.action, "ignored_mic_gated");
  assert.strictEqual(eng.getState().bops, 0);

  // Finish hint playback -> mic ungated -> child's real voice now bops the mole
  eng.finishHintPlayback(5500);
  assert.strictEqual(eng.getState().micGated, false);
  const hit = eng.handleUtterance(oldest.item.accepted_utterances[0], { nowMs: 5800 });
  assert.strictEqual(hit.action, "bop");
  assert.strictEqual(hit.mole.itemId, oldest.itemId);
}

// 7. Gentle expiry ducks down & re-queues later with zero fail state
{
  const pool = [
    { id: "color-green", tier: 1, accepted_utterances: ["green"], confusable_with: [] },
    { id: "color-orange", tier: 1, accepted_utterances: ["orange"], confusable_with: [] },
  ];
  const eng = engineMod.createWhackAMoleEngine({
    items: pool,
    tier: 1,
    voiceMatcher,
    rng: () => 0,
  });
  eng.start(0);
  eng.tick(0);
  const firstId = eng.getState().activeMoles[0].itemId;
  const dwell = engineMod.TIER_CONFIG[1].dwellMs;

  const events = eng.tick(dwell + 500);
  const ducked = events.find((e) => e.type === "duck_down" && e.itemId === firstId);
  assert.ok(ducked, "Expired mole must emit gentle duck_down event");
  assert.strictEqual(eng.getState().status, "playing", "Expiry must never cause a game-over fail state");
  assert.ok(
    eng.getState().requeueIds.includes(firstId) ||
      eng.getState().activeMoles.some((m) => m.itemId === firstId),
    "Expired mole must be re-queued for later practice"
  );
}

// 8. Real vertical-slice integration (Numbers & Colors curriculum + assets/manifest.json)
{
  const numbersCore = JSON.parse(
    fs.readFileSync(path.join(ROOT, "preschool-curriculum", "core", "02_numbers_quantities.json"), "utf8")
  );
  const colorsCore = JSON.parse(
    fs.readFileSync(path.join(ROOT, "preschool-curriculum", "core", "05_colors_measurement.json"), "utf8")
  );
  const assetManifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "assets", "manifest.json"), "utf8")
  );

  const combined = [
    ...numbersCore.items.map((it) => Object.assign({}, it, { domain: "02_numbers_quantities" })),
    ...colorsCore.items.map((it) => Object.assign({}, it, { domain: "05_colors_measurement" })),
  ];
  const tier1Items = engineMod.filterItemsForSession(
    combined,
    ["02_numbers_quantities", "05_colors_measurement"],
    1
  );
  assert.ok(tier1Items.length >= 15, "Expected at least 15 Tier 1 Numbers & Colors items");

  const eng = engineMod.createWhackAMoleEngine({
    items: tier1Items,
    tier: 1,
    voiceMatcher,
    roundTargetBops: 5,
    rng: () => 0.1,
  });
  let now = 0;
  eng.start(now);
  for (let step = 0; step < 5; step++) {
    eng.tick(now);
    const mole = eng.getState().activeMoles[0];
    assert.ok(mole, "Expected an active mole");
    const assetEntry = assetManifest.items[mole.itemId];
    assert.ok(assetEntry && assetEntry.audio && assetEntry.visual && assetEntry.visual.svg, `Missing asset manifest entry for ${mole.itemId}`);
    const out = eng.handleUtterance(mole.item.accepted_utterances[0], { nowMs: now + 200 });
    assert.strictEqual(out.action, "bop");
    if (step === 4) {
      assert.strictEqual(out.roundComplete, true);
      assert.strictEqual(out.winSfx, "round_win");
    }
    now += 2000;
  }
  assert.strictEqual(eng.getState().status, "round_complete");
}

// 9. Offline-only & CSP/SW hygiene audit for web-poc/
{
  const requiredFiles = [
    "web-poc/index.html",
    "web-poc/styles.css",
    "web-poc/sw.js",
    "web-poc/manifest.webmanifest",
    "web-poc/games.manifest.json",
    "web-poc/launcher.js",
    "web-poc/games/whack-a-mole/engine.js",
    "web-poc/games/whack-a-mole/app.js",
    "scripts/serve-web-poc.js",
  ];
  for (const rel of requiredFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `Missing required PoC file: ${rel}`);
  }

  const html = fs.readFileSync(path.join(WEB_POC_DIR, "index.html"), "utf8");
  assert.ok(html.includes("Content-Security-Policy"), "web-poc/index.html must declare CSP");
  assert.ok(html.includes("connect-src 'self'"), "CSP must lock connect-src to 'self'");

  const runtimeFiles = [
    "index.html",
    "styles.css",
    "sw.js",
    "launcher.js",
    "games/whack-a-mole/engine.js",
    "games/whack-a-mole/app.js",
  ];
  for (const rel of runtimeFiles) {
    const text = fs.readFileSync(path.join(WEB_POC_DIR, rel), "utf8");
    const externalUrlMatch = text.match(/https?:\/\/[^\s"'`<>]+/i);
    assert.strictEqual(
      externalUrlMatch,
      null,
      `Disallowed external runtime URL in web-poc/${rel}: ${externalUrlMatch ? externalUrlMatch[0] : ""}`
    );
  }

  const sw = fs.readFileSync(path.join(WEB_POC_DIR, "sw.js"), "utf8");
  for (const asset of [
    "./index.html",
    "./styles.css",
    "./games.manifest.json",
    "./launcher.js",
    "./shared/voice-matcher.js",
    "./games/whack-a-mole/engine.js",
    "./games/whack-a-mole/app.js",
  ]) {
    assert.ok(sw.includes(asset), `Service Worker must precache ${asset}`);
  }
}

console.log(
  "WHACK-A-MOLE POC TESTS PASSED | Launcher, anti-confusion spawner, multi-mole voice matching, 2-retry hint + mic-gating, tier scaling, and offline CSP/SW verified."
);
