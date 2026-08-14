---
type: spec
id: SPEC-loudness-metering-ebur128
title: EBU R 128 loudness metering
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# EBU R 128 loudness metering

## Intent

Add EBU R 128 integrated, short-term, momentary, and true-peak measurement via the
`ebur128` crate, feeding the master bus and export stems without copying, streaming
measurements to the UI at a steady frame rate, and writing a loudness report on offline
export. This is the shared loudness foundation other features build on.

## Non-goals

- The mastering workspace UI (see `mastering-page`).
- Delivery-target loudness normalization (see `delivery-export-targets`).
- The progressive-disclosure plugin metering bridge (see existing `effects-mastering-ui`).

## Requirements

### AC-001 — Accurate short-term LUFS

Loading the EBU R 128 `-23 LUFS` reference signal and playing must read short-term LUFS
within ±0.1 LU of −23.0 on the metering UI.

Verify with: `pnpm cargo:test -- -p daw-dsp ebur128_short_term_accuracy`

### AC-002 — True-peak detection

True-peak measurement must flag inter-sample peaks above −1.0 dBTP on the reference
true-peak fixture within one block of the peak.

Verify with: `pnpm cargo:test -- -p daw-dsp ebur128_true_peak`

### AC-003 — Steady-rate metering channel

The metering channel must deliver frames at 30 ± 3 Hz over a 60 s window while playing.

Verify with: `pnpm cargo:test -- -p daw-dsp ebur128_meter_rate_no_alloc`

### AC-004 — Loudness report on offline export

Offline export must write a loudness report (integrated, short-term max, momentary max,
true-peak) per delivered stem.

Verify with: `pnpm cargo:test -- -p daw-io export_loudness_report`

### AC-005 — No-alloc audio thread

The audio thread must perform zero allocations while feeding the analyser.

Verify with: `pnpm cargo:test -- -p daw-dsp ebur128_meter_rate_no_alloc`

## Open questions

- [ ] (non-blocking) Place the analyser in `daw-dsp` or a new `daw-metering` submodule.
  Default: a `daw-metering` submodule inside `daw-dsp`.

## Affected areas

- `crates/daw-dsp/` (ebur128 integration), master bus + export feed
- Tauri channel for streaming `LoudnessFrame`

## Dropped from sources

- None — this spec scopes the §7.3 items directly.
