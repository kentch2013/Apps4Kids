"use strict";

const CACHE_PREFIX = "apps4kids-webpoc-";
const CACHE_NAME = "apps4kids-webpoc-v3";
const MANIFEST_URL = "../assets/manifest.json";
const PRECACHE_ASSETS = [
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./games.manifest.json",
  "./launcher.js",
  "./shared/voice-matcher.js",
  "./spike-voice/calibration.js",
  "./spike-voice/resampler.js",
  "./spike-voice/vosk-adapter.js",
  "./spike-voice/pcm-worklet.js",
  "./games/whack-a-mole/engine.js",
  "./games/whack-a-mole/app.js",
  "../assets/manifest.json",
  "../preschool-curriculum/core/02_numbers_quantities.json",
  "../preschool-curriculum/core/05_colors_measurement.json",
];
const OPTIONAL_VOSK_ASSETS = [
  "./spike-voice/vendor/vosk/vosk.js",
  "./spike-voice/vendor/vosk/vosk-model-small-en-us-0.15.tar.gz",
];

function extractManifestAssetUrls(manifest, prefix) {
  const basePrefix = typeof prefix === "string" ? prefix : "../";
  const urls = [];
  const seen = new Set();
  if (!manifest || typeof manifest !== "object") {
    return urls;
  }

  function addRel(rel) {
    if (!rel || typeof rel !== "string") return;
    if (/^https?:\/\//i.test(rel) || rel.startsWith("//")) return;
    const normalized = basePrefix + rel.replace(/^\/+/, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  if (manifest.sfx && typeof manifest.sfx === "object") {
    Object.keys(manifest.sfx).forEach(function (key) {
      const entry = manifest.sfx[key];
      if (entry && entry.path) addRel(entry.path);
    });
  }
  if (manifest.prompts && typeof manifest.prompts === "object") {
    Object.keys(manifest.prompts).forEach(function (key) {
      const entry = manifest.prompts[key];
      if (entry && entry.path) addRel(entry.path);
    });
  }
  if (manifest.items && typeof manifest.items === "object") {
    Object.keys(manifest.items).forEach(function (id) {
      const entry = manifest.items[id];
      if (!entry) return;
      if (entry.audio) addRel(entry.audio);
      if (entry.visual && entry.visual.svg) addRel(entry.visual.svg);
    });
  }
  return urls;
}

async function cacheUrlsInBatches(cache, urls, batchSize, fetchFn) {
  const size = typeof batchSize === "number" && batchSize > 0 ? batchSize : 8;
  const doFetch = fetchFn || fetch;
  for (let i = 0; i < urls.length; i += size) {
    const slice = urls.slice(i, i + size);
    await Promise.all(
      slice.map(async function (url) {
        const res = await doFetch(url);
        if (!res || !res.ok) {
          throw new Error("Failed to precache asset: " + url);
        }
        await cache.put(url, res);
      })
    );
  }
  return urls.length;
}

async function cacheOptionalAssets(cache, urls, fetchFn) {
  const doFetch = fetchFn || fetch;
  const cached = [];
  const skipped = [];
  for (const url of urls) {
    try {
      const res = await doFetch(url);
      if (res && res.ok) {
        await cache.put(url, res);
        cached.push(url);
      } else {
        skipped.push(url);
      }
    } catch (_err) {
      skipped.push(url);
    }
  }
  return { cached, skipped };
}

async function precacheAll(cacheStorage, fetchFn) {
  const doFetch = fetchFn || fetch;
  const cache = await cacheStorage.open(CACHE_NAME);
  await cache.addAll(PRECACHE_ASSETS);

  let manifestRes = await cache.match(MANIFEST_URL);
  if (!manifestRes || typeof manifestRes.json !== "function") {
    manifestRes = await doFetch(MANIFEST_URL);
    if (!manifestRes || !manifestRes.ok) {
      throw new Error("Failed to load asset manifest for precaching");
    }
  }
  const manifest = await manifestRes.json();
  const manifestUrls = extractManifestAssetUrls(manifest, "../");
  await cacheUrlsInBatches(cache, manifestUrls, 8, doFetch);
  const voskResult = await cacheOptionalAssets(cache, OPTIONAL_VOSK_ASSETS, doFetch);

  return {
    cacheName: CACHE_NAME,
    coreCount: PRECACHE_ASSETS.length,
    manifestCount: manifestUrls.length,
    voskCached: voskResult.cached,
    voskSkipped: voskResult.skipped,
  };
}

async function cleanupStaleCaches(cacheStorage) {
  const keys = await cacheStorage.keys();
  const stale = keys.filter(function (k) {
    return k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME;
  });
  await Promise.all(
    stale.map(function (k) {
      return cacheStorage.delete(k);
    })
  );
  return stale;
}

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("install", function (event) {
    event.waitUntil(
      precacheAll(caches, fetch).then(function () {
        return self.skipWaiting();
      })
    );
  });

  self.addEventListener("activate", function (event) {
    event.waitUntil(
      cleanupStaleCaches(caches).then(function () {
        return self.clients.claim();
      })
    );
  });

  self.addEventListener("fetch", function (event) {
    if (event.request.method !== "GET") {
      return;
    }
    const reqUrl = new URL(event.request.url);
    if (reqUrl.origin !== self.location.origin) {
      return;
    }
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(event.request).then(function (cached) {
          if (cached) return cached;
          return fetch(event.request).then(function (networkRes) {
            if (networkRes && networkRes.status === 200) {
              cache.put(event.request, networkRes.clone());
            }
            return networkRes;
          });
        });
      })
    );
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    CACHE_PREFIX,
    CACHE_NAME,
    MANIFEST_URL,
    PRECACHE_ASSETS,
    OPTIONAL_VOSK_ASSETS,
    extractManifestAssetUrls,
    cacheUrlsInBatches,
    cacheOptionalAssets,
    precacheAll,
    cleanupStaleCaches,
  };
}
