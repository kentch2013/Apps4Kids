#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.PORT || "8444", 10);

const ALLOWED_ROOTS = [
  path.join(ROOT, "web-poc"),
  path.join(ROOT, "assets"),
  path.join(ROOT, "preschool-curriculum", "core"),
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

function isAllowedPath(fullPath) {
  return ALLOWED_ROOTS.some((dir) => fullPath === dir || fullPath.startsWith(dir + path.sep));
}

const server = http.createServer((req, res) => {
  const cleanUrl = (req.url || "/").split("?")[0];
  if (cleanUrl === "/" || cleanUrl === "/web-poc" || cleanUrl === "/web-poc/") {
    res.writeHead(302, { Location: "/web-poc/index.html" });
    res.end();
    return;
  }

  const relPath = cleanUrl.replace(/^\/+/, "");
  const fullPath = path.resolve(ROOT, relPath);
  if (!isAllowedPath(fullPath)) {
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
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    };
    if (cleanUrl === "/web-poc/sw.js") {
      headers["Service-Worker-Allowed"] = "/";
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(fullPath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Apps4Kids Web PoC listening at http://localhost:${PORT}/web-poc/index.html`);
  });
}

module.exports = { server, isAllowedPath };
