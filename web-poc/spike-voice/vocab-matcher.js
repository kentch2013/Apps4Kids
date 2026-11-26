(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Apps4KidsVocabMatcher = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VOCABULARY = Object.freeze([
    { canonical: "one", category: "number", aliases: ["1", "won"] },
    { canonical: "two", category: "number", aliases: ["2", "to", "too"] },
    { canonical: "three", category: "number", aliases: ["3", "tree"] },
    { canonical: "four", category: "number", aliases: ["4", "for", "fore"] },
    { canonical: "five", category: "number", aliases: ["5"] },
    { canonical: "six", category: "number", aliases: ["6", "sicks"] },
    { canonical: "seven", category: "number", aliases: ["7"] },
    { canonical: "eight", category: "number", aliases: ["8", "ate"] },
    { canonical: "nine", category: "number", aliases: ["9"] },
    { canonical: "ten", category: "number", aliases: ["10"] },
    { canonical: "red", category: "color", aliases: ["read"] },
    { canonical: "blue", category: "color", aliases: ["blew"] },
    { canonical: "green", category: "color", aliases: [] },
    { canonical: "yellow", category: "color", aliases: [] },
    { canonical: "orange", category: "color", aliases: [] },
    { canonical: "purple", category: "color", aliases: [] },
    { canonical: "stop", category: "command", aliases: [] },
    { canonical: "repeat", category: "command", aliases: [] },
  ]);

  const LOOKUP = new Map();
  for (const entry of VOCABULARY) {
    LOOKUP.set(entry.canonical, { canonical: entry.canonical, category: entry.category });
    for (const alias of entry.aliases) {
      LOOKUP.set(alias, { canonical: entry.canonical, category: entry.category });
    }
  }

  function getVoskGrammarList() {
    const words = VOCABULARY.map((entry) => entry.canonical);
    words.push("[unk]");
    return words;
  }

  function matchUtterance(rawText) {
    if (typeof rawText !== "string") {
      return { matched: false, canonical: null, category: null };
    }
    const cleaned = rawText
      .toLowerCase()
      .replace(/[^a-z0-9\s\[\]]+/g, " ")
      .trim();
    if (!cleaned || cleaned === "[unk]") {
      return { matched: false, canonical: null, category: null };
    }
    const tokens = cleaned.split(/\s+/);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const hit = LOOKUP.get(tokens[i]);
      if (hit) {
        return { matched: true, canonical: hit.canonical, category: hit.category };
      }
    }
    return { matched: false, canonical: null, category: null };
  }

  return {
    VOCABULARY,
    getVoskGrammarList,
    matchUtterance,
  };
});
