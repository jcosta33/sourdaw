---
type: spec
id: SPEC-microtuning-engine
title: Microtuning engine — tuning table and microtonal math
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Microtuning engine — tuning table and microtonal math

## Intent

Replace hard-coded 12-TET oscillator math with a lock-free tuning table delivered from
the UI thread to the audio thread via triple buffering, plus a public microtonal math
module (Surge-parity `Tone`/`Scale`/`KeyboardMapping`, cents↔ratio, two pitch-bend modes,
log2-space portamento). This is the engine foundation every other microtuning feature
reads from.

## Non-goals

- MTS-ESP retuning of third-party plugins (see `mts-esp-host`).
- Scala file parsing (see `scala-tuning-formats`).
- The adaptive N-TET piano roll (see `microtonal-piano-roll`).
- Non-destructive key-change folding (see `scale-folding`).

## Requirements

### AC-001 — Compact tuning table

`TuningTable { frequencies: [f64;128], log2_frequencies: [f64;128], reference_freq,
reference_note }` must be a fixed ~2 KB struct, both arrays pre-computed on every tuning
change.

Verify with: `pnpm cargo:test -- -p daw-core tuning_table_size`

### AC-002 — Lock-free triple-buffer delivery, no torn reads

Updates must flow UI→audio via `triple_buffer`; pushing 1000 updates/s must never let the
audio thread observe a torn table (CRC-checked stress test), with zero allocation on the
read path.

Verify with: `pnpm cargo:test -- -p daw-engine tuning_table_no_tearing`

### AC-003 — 12-TET formula eliminated

Oscillator pitch must come from table lookup; `rg "2.0_f64.powf.*/\s*12"` returns zero
hits inside `daw-engine` and `daw-dsp`.

Verify with: `rg "2.0_f64.powf.*/\s*12" crates/daw-engine crates/daw-dsp`

### AC-004 — Exact cents↔ratio math

`5/4` → cents must yield `386.3137138648348` and back to `1.25`, each within 1e-12.

Verify with: `pnpm cargo:test -- -p daw-core cents_ratio_roundtrip`

### AC-005 — Log2 interpolation for fractional notes

Fractional MIDI note `60.5` must return the log2-space midpoint of table entries 60 and 61
within 1e-9 Hz; portamento 60→72 is monotonic in log2 within 1e-9 of linear-in-log2.

Verify with: `pnpm cargo:test -- -p daw-core fractional_note_log2_interp`

### AC-006 — Persisted pitch-bend mode

A patch saved with `pitch_bend_mode = ScaleDegree` must round-trip through save/load
bit-identically.

Verify with: `pnpm cargo:test -- -p daw-core pitch_bend_mode_roundtrip`

## Open questions

- [ ] (non-blocking) Whether the `microtuning` math lives in `daw-core` or a dedicated
  crate. Default: `daw-core` public module.

## Affected areas

- `crates/daw-core/` (TuningTable, microtuning math module)
- `crates/daw-engine/`, `crates/daw-dsp/` (oscillator pitch via lookup)

## Dropped from sources

- None — scopes §10.2 and §10.3 directly.
