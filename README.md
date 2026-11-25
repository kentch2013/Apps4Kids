# Apps4Kids

`Apps4Kids` provides structured, US Kindergarten-readiness visual curriculum datasets for preschool learning applications (`preschool-curriculum/`).

## Dual-Dataset Structure (`core/` vs. `comprehensive/`)

The curriculum is organized into two difficulty-tiered JSON datasets across 9 academic domains:

- **`preschool-curriculum/core/` (~400 items):** A focused, high-priority baseline covering essential Kindergarten-readiness visual recognition concepts. All items have `in_core: true`.
- **`preschool-curriculum/comprehensive/` (1,000+ items):** A 100% superset of `core/` that adds deeper coverage (case pairs, confusable letters, base-10 blocks, fractions, visual operations, coin equivalencies, half/quarter-hour clocks, life cycles, solar system, expanded community helpers, and nuanced SEL cues). Additional items have `in_core: false`.

Metadata and validation contracts live in:
- [`preschool-curriculum/schema.json`](preschool-curriculum/schema.json) (JSON Schema Draft 2020-12)
- [`preschool-curriculum/taxonomy.json`](preschool-curriculum/taxonomy.json) (domains, difficulty tiers, and visual types)

## Strict Visual-Only Design Rule

Everything presented to the child on screen is **purely visual**:
- **No spelling drills, no sight-word lists, and no multi-letter English words** appear in `display_token` or on-screen visuals.
- Valid on-screen tokens include single letters (`A`–`Z`, `a`–`z`), letter pairs (`A a`, `b / d`), numerals (`0`–`100`), fractions (`1/2`), clock times (`3:00`), math/punctuation/safety symbols, hex color swatches, shapes, quantities, and illustrated concepts.
- `label` and `audio_prompt` are strictly for spoken TTS audio and developer metadata—never rendered as text to the child.

## Academic Domains & Difficulty Tiers

### 9 Domains
1. `01_letters.json` — Letters & Alphabet Recognition
2. `02_numbers_quantities.json` — Numbers & Quantities
3. `03_symbols_icons.json` — Symbols & Universal Icons
4. `04_shapes_spatial.json` — Shapes & Spatial Relations
5. `05_colors_measurement.json` — Colors, Attributes & Measurement
6. `06_time_money.json` — Time & US Money
7. `07_science_nature.json` — Science & Nature
8. `08_social_community.json` — Social Studies & Community
9. `09_emotions_everyday.json` — Emotions, SEL & Everyday Academic Concepts

### 4 Difficulty Tiers
- **Tier 1 (`foundational`, 3.5–4.0 yrs):** High-salience everyday visuals (primary colors, basic 2D shapes, numerals 0–5, high-frequency uppercase letters, common animals, basic emotions).
- **Tier 2 (`developing`, 4.0–4.5 yrs):** Full uppercase A–Z, numerals 0–10, perceptual subitizing 1–5, 11 core colors, 5 senses, 4 seasons, core community helpers, `AB` patterns.
- **Tier 3 (`k_ready`, 4.5–5.0 yrs):** Full lowercase a–z & confusable pairs, numerals 11–20, conceptual subitizing 6–10, 3D solids, math operators, US coins, on-the-hour clocks, spatial prepositions, life cycles, US symbols.
- **Tier 4 (`stretch`, 5.0–5.5 yrs):** Numerals 21–100 milestones, visual fractions, half/quarter-hour clocks, US bills & coin equivalencies, `<`/`>` comparisons, extended polygons, symmetry, solar system, nuanced SEL cues.

### US Standards Alignment
Items are anchored to **Head Start ELOF**, **Common Core State Standards (Kindergarten Math & ELA)**, **NGSS (Grade K)**, and the **C3 Framework for Social Studies (Grade K)**.

## Verification

Run the zero-dependency Node.js validator to verify schema, taxonomy, item counts, visual-only compliance, and `core/` ⊆ `comprehensive/` superset integrity:

```bash
node scripts/validate-curriculum.js
```
