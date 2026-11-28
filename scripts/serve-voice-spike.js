#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SPIKE_DIR = path.join(ROOT, "web-poc", "spike-voice");
const DEFAULT_PORT = 8443;
const DEFAULT_CERT = path.join(ROOT, ".certs", "dev-cert.pem");
const DEFAULT_KEY = path.join(ROOT, ".certs", "dev-key.pem");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

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
}

function validateTlsCertFiles(certPath, keyPath) {
  const missing = [];
  if (!fs.existsSync(certPath)) {
    missing.push(`TLS certificate: ${certPath}`);
  }
  if (!fs.existsSync(keyPath)) {
    missing.push(`TLS private key: ${keyPath}`);
  }
  if (missing.length === 0) {
    return null;
  }
  return [
    "[ERROR] Cannot start HTTPS server: missing local TLS certificate file(s):",
    ...missing.map((m) => `  - ${m}`),
    "",
    "How to fix:",
    "  1. Generate trusted LAN certs on Windows:",
    "       winget install FiloSottile.mkcert",
    "       mkcert -install",
    "       npm run stage:live",
    "  2. Or pass custom certificate paths:",
    "       npm run serve:spike -- --cert <path> --key <path>",
    "  3. Or run over HTTP on desktop localhost (omit --https):",
    "       npm run serve:spike",
  ].join("\n");
}

function createServerInstance(opts) {
  const cfg = opts || { httpsEnabled: false };
  if (cfg.httpsEnabled) {
    const missingMsg = validateTlsCertFiles(cfg.certPath, cfg.keyPath);
    if (missingMsg) {
      const err = new Error(missingMsg);
      err.code = "TLS_CERT_MISSING";
      throw err;
    }
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
  let cfg;
  let activeServer;
  try {
    cfg = parseServerArgs(process.argv.slice(2), process.env);
    activeServer = cfg.httpsEnabled ? createServerInstance(cfg) : server;
  } catch (err) {
    if (err && err.code === "TLS_CERT_MISSING") {
      console.error(err.message);
      process.exit(1);
    }
    console.error(`[ERROR] ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  }
  const proto = cfg.httpsEnabled ? "https" : "http";
  activeServer.listen(cfg.port, "0.0.0.0", () => {
    console.log(`Apps4Kids Gate 0 Voice Spike listening at ${proto}://localhost:${cfg.port}`);
    for (const ip of getLanAddresses()) {
      console.log(`  LAN (iPhone Safari): ${proto}://${ip}:${cfg.port}`);
    }
  });
}

module.exports = { server, parseServerArgs, createServerInstance, getLanAddresses, validateTlsCertFiles };
