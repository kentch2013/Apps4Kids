"use strict";

const CACHE_NAME = "apps4kids-webpoc-v2";
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

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k !== CACHE_NAME;
          })
          .map(function (k) {
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (networkRes) {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return networkRes;
      });
    })
  );
});
