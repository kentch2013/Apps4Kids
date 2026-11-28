"use strict";

const CACHE_PREFIX = "apps4kids-gate0-voice-";
const CACHE_NAME = "apps4kids-gate0-voice-v3";
const PRECACHE_ASSETS = [
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./calibration.js",
  "./resampler.js",
  "./vocab-matcher.js",
  "./vosk-adapter.js",
  "./pcm-worklet.js",
  "./app.js",
];
const OPTIONAL_VOSK_ASSETS = [
  "./vendor/vosk/vosk.js",
  "./vendor/vosk/vosk-model-small-en-us-0.15.tar.gz",
];

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
  const voskResult = await cacheOptionalAssets(cache, OPTIONAL_VOSK_ASSETS, doFetch);
  return {
    cacheName: CACHE_NAME,
    coreCount: PRECACHE_ASSETS.length,
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
          return fetch(event.request)
            .then(function (networkRes) {
              if (networkRes && networkRes.status === 200) {
                cache.put(event.request, networkRes.clone());
              }
              return networkRes;
            })
            .catch(function (err) {
              if (event.request.mode === "navigate") {
                return cache.match("./index.html");
              }
              throw err;
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
    PRECACHE_ASSETS,
    OPTIONAL_VOSK_ASSETS,
    cacheOptionalAssets,
    precacheAll,
    cleanupStaleCaches,
  };
}
