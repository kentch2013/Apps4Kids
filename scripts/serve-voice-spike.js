#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const SPIKE_DIR = path.resolve(__dirname, "..", "web-poc", "spike-voice");
const PORT = parseInt(process.env.PORT || "8443", 10);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

const server = http.createServer((req, res) => {
  const cleanUrl = (req.url || "/").split("?")[0];
  const relPath = cleanUrl === "/" ? "index.html" : cleanUrl.replace(/^\/+/, "");
  const fullPath = path.resolve(SPIKE_DIR, relPath);

  if (!fullPath.startsWith(SPIKE_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(fullPath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Apps4Kids Gate 0 Voice Spike listening at http://localhost:${PORT}`);
  });
}

module.exports = { server };
