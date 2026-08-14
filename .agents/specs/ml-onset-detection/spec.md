---
type: spec
id: SPEC-ml-onset-detection
title: ML-based transient detection
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
---

# ML-based transient detection

## Intent

Add a CNN-based onset detector that handles soft onsets and polyphonic material far
better than spectral flux, exposed as a shared primitive that feeds snap-to-transient
navigation, audio quantization (elastic audio), beat slicing, and audio-to-MIDI. Fall
back to the existing spectral-flux detector where ML inference is unavailable.

## Non-goals

- The warp/elastic-audio feature itself (see existing `elastic-audio`).
- Beat slicing UI (see existing `slicer`).
- Replacing the existing spectral-flux path — it remains the fallback.

## Requirements

### AC-001 — ONNX onset model exposed as a Tauri command

A small ONNX onset model must run via the existing `ort` runtime and expose a command
returning onset events with frame position and confidence.

Verify with: `pnpm cargo:test -- -p daw-dsp detect_onsets_ml`

### AC-002 — Accuracy beats spectral flux on the reference set

The detector must place onsets on the reference drum-break fixture with >94% precision
vs the hand-marked ground truth.

Verify with: `pnpm cargo:test -- -p daw-dsp onset_ml_precision`

### AC-003 — Spectral-flux fallback without ONNX

On a platform without ONNX support (browser without Tauri), onset detection must fall
back to the existing spectral-flux detector.

Verify with: `pnpm test:run -- onsetDetectorFallback`

### AC-004 — Wired into existing consumers as an alternative detector

The ML detector output must be selectable as an alternative onset source for elastic
audio and audio-to-MIDI.

Verify with: `pnpm test:run -- audioToMidi`

## Open questions

- [ ] (non-blocking) Which open onset model/dataset to ship (madmom-derived candidate)
  and its exact size budget (~5–10 MB). Resolve during implementation.

## Affected areas

- `crates/daw-dsp/src/crumbs/analysis/onset.rs`, `src-tauri/` (ONNX command)
- `src/modules/Arrangement/useCases/` (elasticAudio, audioToMidi consumers)

## Dropped from sources

- A bundled training pipeline — out of scope; a pre-trained model is shipped.
