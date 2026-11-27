(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Apps4KidsLauncher = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function indexDomains(manifest) {
    const map = new Map();
    const list = manifest && Array.isArray(manifest.domains) ? manifest.domains : [];
    for (const d of list) {
      if (d && typeof d.id === "string") {
        map.set(d.id, d);
      }
    }
    return map;
  }

  // Path A (Skill -> Games): filter games supporting all selected active domains and the chosen tier
  function getEligibleGames(manifest, selectedDomains, tier) {
    if (!manifest || !Array.isArray(manifest.games)) return [];
    const domains = Array.isArray(selectedDomains) ? selectedDomains.filter(Boolean) : [];
    if (domains.length === 0) return [];
    const tierNum = Number(tier);
    if (!Number.isInteger(tierNum) || tierNum < 1 || tierNum > 4) return [];

    const domainMap = indexDomains(manifest);
    for (const domId of domains) {
      const dom = domainMap.get(domId);
      if (!dom || dom.active !== true) {
        return [];
      }
    }

    return manifest.games.filter(function (game) {
      if (!game || !Array.isArray(game.supported_domains) || !Array.isArray(game.supported_tiers)) {
        return false;
      }
      if (!game.supported_tiers.includes(tierNum)) {
        return false;
      }
      return domains.every(function (domId) {
        return game.supported_domains.includes(domId);
      });
    });
  }

  // Path B (Game -> Skills): return active supported domains and tiers for a selected game
  function getEligibleSkills(manifest, gameId) {
    if (!manifest || !Array.isArray(manifest.games)) {
      return { game: null, domains: [], tiers: [] };
    }
    const game = manifest.games.find(function (g) {
      return g && g.id === gameId;
    });
    if (!game) {
      return { game: null, domains: [], tiers: [] };
    }
    const domainMap = indexDomains(manifest);
    const domains = (game.supported_domains || [])
      .map(function (id) {
        return domainMap.get(id);
      })
      .filter(function (d) {
        return d && d.active === true;
      });
    const tiers = Array.isArray(game.supported_tiers) ? game.supported_tiers.slice() : [];
    return { game, domains, tiers };
  }

  function buildSessionConfig(manifest, selection) {
    const sel = selection || {};
    const tier = Number(sel.tier);
    const domains = Array.isArray(sel.domains) ? sel.domains.slice() : [];
    const eligibleGames = getEligibleGames(manifest, domains, tier);
    const game = eligibleGames.find(function (g) {
      return g.id === sel.gameId;
    });
    if (!game) {
      throw new Error("Invalid session selection: game does not support chosen domains/tier");
    }
    const domainMap = indexDomains(manifest);
    return {
      gameId: game.id,
      gameName: game.name,
      tier,
      domains,
      curriculumFiles: domains.map(function (id) {
        return domainMap.get(id).curriculum_file;
      }),
    };
  }

  return {
    getEligibleGames,
    getEligibleSkills,
    buildSessionConfig,
  };
});
