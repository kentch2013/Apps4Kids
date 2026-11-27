#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PORT = 8444;
const DEFAULT_CERT = path.join(ROOT, ".certs", "dev-cert.pem");
const DEFAULT_KEY = path.join(ROOT, ".certs", "dev-key.pem");

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

function parseServerArgs(argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  const e = env || process.env;
  let port = parseInt(e.PORT || String(DEFAULT_PORT), 10);
  let certPath = e.TLS_CERT || "";
  let keyPath = e.TLS_KEY || "";
  let useDefaultHttps = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--cert" && args[i + 1]) {
      certPath = args[++i];
    } else if (a === "--key" && args[i + 1]) {
      keyPath = args[++i];
    } else if (a === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (a === "--https") {
      useDefaultHttps = true;
    }
  }

  if (useDefaultHttps && !certPath && !keyPath) {
    certPath = DEFAULT_CERT;
    keyPath = DEFAULT_KEY;
  }

  const httpsEnabled = Boolean(certPath || keyPath);
  if (httpsEnabled && (!certPath || !keyPath)) {
    throw new Error("HTTPS mode requires both --cert and --key paths.");
  }

  return { port, certPath, keyPath, httpsEnabled };
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const info of nets[name] || []) {
      if (info && info.family === "IPv4" && !info.internal) {
        addrs.push(info.address);
      }
    }
  }
  return addrs;
}

function requestHandler(req, res) {
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
}

function createServerInstance(opts) {
  const cfg = opts || { httpsEnabled: false };
  if (cfg.httpsEnabled) {
    const tlsOptions = {
      cert: fs.readFileSync(cfg.certPath),
      key: fs.readFileSync(cfg.keyPath),
    };
    return https.createServer(tlsOptions, requestHandler);
  }
  return http.createServer(requestHandler);
}

const server = http.createServer(requestHandler);

if (require.main === module) {
  const cfg = parseServerArgs(process.argv.slice(2), process.env);
  const activeServer = cfg.httpsEnabled ? createServerInstance(cfg) : server;
  const proto = cfg.httpsEnabled ? "https" : "http";
  activeServer.listen(cfg.port, "0.0.0.0", () => {
    console.log(`Apps4Kids Web PoC listening at ${proto}://localhost:${cfg.port}/web-poc/index.html`);
    for (const ip of getLanAddresses()) {
      console.log(`  LAN (iPhone Safari): ${proto}://${ip}:${cfg.port}/web-poc/index.html`);
    }
  });
}

module.exports = { server, isAllowedPath, parseServerArgs, createServerInstance, getLanAddresses };
