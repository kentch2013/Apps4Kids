# Apps4Kids — Asset, Code & Runtime License Policy

This policy defines strict licensing and runtime boundaries for `Apps4Kids` to keep future **iOS App Store commercialization** legally clean and unencumbered.

## 1. Consumer Runtime vs. Asset Creation Boundary

- **Consumer Runtime (Strict):** The shipped application (browser PoC and future iOS app) must run **100% offline** with **zero cloud AI** and **zero external runtime API calls**. Local open-license speech recognition models (e.g., Apache-2.0 acoustic/STT models) are permitted only when bundled/cached locally with zero runtime network traffic.
- **Offline Asset Creation (Permitted):** Offline or AI-assisted tooling may be used during development to author illustrations, sound effects, or prerecorded voice clips, provided the resulting static files are committed/bundled cleanly with clear commercial rights and no disallowed third-party license encumbrances.

## 2. Allowed Licenses (Permissive Only)

All runtime source code, speech models, illustrations, sound effects, and prerecorded audio must use one of the following:

- **Original author-created works** (owned by `kentch2013` / project contributors under the root MIT `LICENSE`)
- **CC0 1.0 / Public Domain** (preferred for illustrations, icons, and SFX)
- **MIT**
- **Apache-2.0**
- **BSD** (2-Clause or 3-Clause)
- **ISC / Unlicense / Zlib** (permissive equivalents)
- **CC-BY 4.0** (only when attribution is recorded in `assets/ATTRIBUTION.json` and no ShareAlike/NC/ND restriction applies)

## 3. Disallowed Licenses (Hard Block)

Do **not** import, vendor, or bundle any dependency, model, icon pack, or audio clip licensed under:

- **GPL** (v2 / v3)
- **AGPL** (v3)
- **LGPL** (where static linking or iOS App Store distribution restrictions apply)
- **CC-BY-SA** (ShareAlike / copyleft media packs such as OpenMoji)
- **Creative Commons NC** (NonCommercial)
- **Creative Commons ND** (NoDerivatives)
- **Unknown / unlicensed** assets scraped without verifiable license provenance

## 4. Attribution Manifest Contract (`assets/ATTRIBUTION.json`)

Every third-party asset added under `assets/` (and optionally original assets for completeness) must have an entry in `assets/ATTRIBUTION.json` following this JSON structure:

```json
{
  "schema_version": 1,
  "assets": [
    {
      "path": "assets/audio/sfx/bop.mp3",
      "title": "Soft Cartoon Bop",
      "author": "Author or Studio Name",
      "source_url": "https://example.org/asset-page",
      "license": "CC0-1.0",
      "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
      "notes": "Trimmed to 180ms mono 16kHz"
    }
  ]
}
```

### Required Entry Fields

| Field | Type | Requirement |
| :--- | :--- | :--- |
| `path` | string | Repo-relative path to the asset file under `assets/` |
| `title` | string | Human-readable asset title |
| `author` | string | Creator or organization name (`"kentch2013"` for original assets) |
| `source_url` | string | Canonical source URL (`"original"` for author-created assets) |
| `license` | string | Exact SPDX identifier from Allowed Licenses (`CC0-1.0`, `MIT`, `Apache-2.0`, `BSD-3-Clause`, `CC-BY-4.0`, or `Original`) |
| `license_url` | string | Canonical URL for the license text (or `"LICENSE"` for repo MIT) |
| `notes` | string | Optional modification or provenance notes |

## 5. Verification

Run both deterministic repo validators before opening or merging any PR:

```bash
node scripts/validate-curriculum.js
node scripts/validate-license-policy.js
```
