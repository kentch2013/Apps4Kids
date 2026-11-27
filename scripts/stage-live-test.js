#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VENDOR_DIR = path.join(ROOT, "web-poc", "spike-voice", "vendor", "vosk");
const CERTS_DIR = path.join(ROOT, ".certs");

const VOSK_ASSETS = Object.freeze([
  Object.freeze({
    name: "vosk.js",
    license: "Apache-2.0",
    minBytes: 50 * 1024,
    url: "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js",
    dest: path.join(VENDOR_DIR, "vosk.js"),
  }),
  Object.freeze({
    name: "vosk-model-small-en-us-0.15.tar.gz",
    license: "Apache-2.0",
    minBytes: 30 * 1024 * 1024,
    url: "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz",
    dest: path.join(VENDOR_DIR, "vosk-model-small-en-us-0.15.tar.gz"),
  }),
]);

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

function downloadFile(url, destPath, redirectsLeft) {
  const maxRedirects = typeof redirectsLeft === "number" ? redirectsLeft : 5;
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + ".tmp";
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) {
          reject(new Error("Too many redirects for " + url));
          return;
        }
        const nextUrl = new URL(res.headers.location, url).toString();
        downloadFile(nextUrl, destPath, maxRedirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }
      const out = fs.createWriteStream(tmpPath);
      res.pipe(out);
      out.on("finish", () => {
        out.close(() => {
          fs.renameSync(tmpPath, destPath);
          resolve(fs.statSync(destPath).size);
        });
      });
      out.on("error", (err) => {
        fs.rmSync(tmpPath, { force: true });
        reject(err);
      });
    });
    req.on("error", (err) => {
      fs.rmSync(tmpPath, { force: true });
      reject(err);
    });
  });
}

function tryGenerateLocalCert() {
  const certPath = path.join(CERTS_DIR, "dev-cert.pem");
  const keyPath = path.join(CERTS_DIR, "dev-key.pem");
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { status: "existing", certPath, keyPath };
  }

  fs.mkdirSync(CERTS_DIR, { recursive: true });
  const hosts = ["localhost", "127.0.0.1"].concat(getLanAddresses());

  const mkcertCheck = spawnSync("mkcert", ["-cert-file", certPath, "-key-file", keyPath].concat(hosts), {
    encoding: "utf8",
  });
  if (mkcertCheck.status === 0 && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { status: "mkcert", certPath, keyPath };
  }

  const san = hosts
    .map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? `IP:${h}` : `DNS:${h}`))
    .join(",");
  const opensslCheck = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "30",
      "-subj",
      "/CN=Apps4Kids Local Dev",
      "-addext",
      "subjectAltName=" + san,
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { encoding: "utf8" }
  );
  if (opensslCheck.status === 0 && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { status: "openssl", certPath, keyPath };
  }

  return { status: "missing_tool", certPath, keyPath };
}

async function run(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const dryRun = args.includes("--dry-run");
  const skipCerts = args.includes("--skip-certs");

  if (dryRun) {
    console.log("STAGE LIVE TEST DRY-RUN:");
    for (const asset of VOSK_ASSETS) {
      const staged = fs.existsSync(asset.dest) && fs.statSync(asset.dest).size >= asset.minBytes;
      console.log(` - ${asset.name} [${asset.license}] -> ${staged ? "STAGED" : "PENDING"} (${asset.dest})`);
    }
    const hasCert =
      fs.existsSync(path.join(CERTS_DIR, "dev-cert.pem")) &&
      fs.existsSync(path.join(CERTS_DIR, "dev-key.pem"));
    console.log(` - Local TLS certs (.certs/dev-cert.pem & dev-key.pem) -> ${hasCert ? "STAGED" : "PENDING"}`);
    return { ok: true, dryRun: true };
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  for (const asset of VOSK_ASSETS) {
    if (fs.existsSync(asset.dest) && fs.statSync(asset.dest).size >= asset.minBytes) {
      console.log(`[OK] Already staged: ${asset.name}`);
      continue;
    }
    console.log(`[DOWNLOADING] ${asset.name} (${asset.license})...`);
    const bytes = await downloadFile(asset.url, asset.dest);
    if (bytes < asset.minBytes) {
      fs.rmSync(asset.dest, { force: true });
      throw new Error(`Downloaded ${asset.name} is unexpectedly small (${bytes} bytes).`);
    }
    console.log(`[OK] Staged ${asset.name} (${(bytes / (1024 * 1024)).toFixed(2)} MB)`);
  }

  if (!skipCerts) {
    const certRes = tryGenerateLocalCert();
    if (certRes.status === "existing" || certRes.status === "mkcert" || certRes.status === "openssl") {
      console.log(`[OK] Local TLS cert ready (${certRes.status}): ${certRes.certPath}`);
    } else {
      console.log("[INFO] Neither mkcert nor openssl found on PATH. Desktop localhost works over HTTP; install mkcert for iPhone LAN HTTPS.");
    }
  }

  console.log("\nReady to launch:");
  console.log("  Desktop Chrome (HTTP localhost): npm run serve:poc");
  console.log("  iPhone Safari (LAN HTTPS):       npm run serve:poc -- --https");
  console.log("  Gate 0 Voice Spike (LAN HTTPS):  npm run serve:spike -- --https");
  return { ok: true, dryRun: false };
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error("STAGE LIVE TEST FAILED:", err.message);
    process.exit(1);
  });
}

module.exports = { VOSK_ASSETS, VENDOR_DIR, CERTS_DIR, getLanAddresses, run };
