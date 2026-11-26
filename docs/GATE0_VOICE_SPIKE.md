# Gate 0 Voice Spike — Offline Recognition & Mic Calibration Report

**Issue:** `#5` (`INB-20261125-02`)  
**Spike Directory:** `web-poc/spike-voice/`  
**Local Server:** `node scripts/serve-voice-spike.js` (default port `8443`)

---

## 1. Architecture & Permissive License Audit

- **100% Offline Consumer Runtime:** `web-poc/spike-voice/index.html` enforces `Content-Security-Policy: default-src 'self'; connect-src 'self'` and precaches all static assets via `web-poc/spike-voice/sw.js`. Zero external CDN or cloud API calls occur at runtime.
- **Primary Candidate Engine (Browser WASM):** `vosk-browser` (Apache-2.0 / MIT compatible wrapper over Vosk) + `vosk-model-small-en-us-0.15` (~40 MB, **Apache-2.0**).
  - *Hard Exclusion:* Do **not** use `vosk-model-small-en-us-zamia-0.5` (49 MB), which is **LGPL-3.0** and blocked by `docs/ASSETS_LICENSE_POLICY.md`.
- **Fallback Candidate (Native Wrapper):** `sherpa-onnx` (**Apache-2.0**) or Apple on-device Speech framework inside a thin native iOS / Capacitor wrapper if iPhone Safari WASM memory or latency fails Gate 0 thresholds.
- **iOS Safari Safeguards Built into Spike:**
  - Single parent tap (`Start Calibration`) unlocks `AudioContext` + `getUserMedia`; all subsequent steps are voice-only.
  - Deterministic `48 kHz -> 16 kHz` linear downsampler (`resampler.js`) handles iOS Safari hardware sample rates.
  - Constrained grammar (`vocab-matcher.js`): numbers `one`–`ten`, colors (`red`, `blue`, `green`, `yellow`, `orange`, `purple`), commands (`stop`, `repeat`), plus `[unk]` rejection token.

---

## 2. Staging the Local Offline Model (One-Time Dev Setup)

To keep the Git repository lightweight, the 40 MB model archive is not committed to Git. Before running live browser benchmarks:

1. Place the local `vosk-browser` bundle and `vosk-model-small-en-us-0.15.tar.gz` under `web-poc/spike-voice/vendor/vosk/` and include the local `<script src="./vendor/vosk/vosk.js"></script>` tag when testing live WASM decoding.
2. Start the local server:
   ```bash
   node scripts/serve-voice-spike.js
   ```
3. Load the page once on desktop Chrome and iPhone Safari (over local HTTPS/LAN), confirm `"Service Worker active (offline ready)"`, then switch to **DevTools Offline** (desktop) and **Airplane Mode** (iPhone Safari).

---

## 3. Gate 0 Go/No-Go Pass Thresholds

| Metric | Target Threshold (Go) | Pivot Trigger (No-Go -> Native iOS / Capacitor) |
| :--- | :--- | :--- |
| Model cache size | <= 50 MB | > 100 MB or Safari cache eviction |
| Cold-start load time | <= 8.0 s | > 15.0 s |
| 3-minute continuous listening stability | 180s / 180s (0 tab crashes/reloads) | Any iOS Safari Jetsam tab kill or audio freeze |
| End-to-end latency (speech end -> token) | <= 600 ms (p95) | > 1200 ms (breaks Whack-a-Mole pacing) |
| Constrained-word accuracy (16-word set) | >= 85% | < 70% |
| False-positive rate during room noise | <= 1 per minute | >= 3 per minute |

---

## 4. Benchmark Results (Record On-Device Runs)

| Environment | Engine Mode | Model Size (MB) | Cold-Start Load (s) | 3-Min Stability | p50 / p95 Latency (ms) | Word Accuracy (%) | False Positives (3 min) | Offline Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Automated Node Suite (`test-voice-spike.js`) | Deterministic unit + CSP/SW audit | N/A | N/A | N/A | Mocked OK | 100% unit | 0 | Pass (CSP + SW) |
| Desktop Chrome (DevTools Offline) | *Pending local model run* | — | — | — | — | — | — | — |
| iPhone Safari (Airplane Mode) | *Pending on-device run* | — | — | — | — | — | — | — |

---

## 5. Go/No-Go Decision

- **Current Status:** **PENDING ON-DEVICE IPHONE SAFARI RUN** (automated spike harness, 2-stage calibration, 48 kHz -> 16 kHz resampler, constrained grammar, Service Worker offline shell, and CSP gates are implemented and passing).
- **Decision Rule:**
  - **(a) GO — Proceed with Browser WASM PoC (`web-poc/`):** If iPhone Safari in Airplane Mode meets all Section 3 thresholds over a full 3-minute session.
  - **(b) NO-GO — Pivot to Thin Native iOS / Capacitor Wrapper:** If iPhone Safari Jetsam kills the WASM tab, fails to hold mic capture for 3 minutes, or exceeds 1200 ms p95 latency.
