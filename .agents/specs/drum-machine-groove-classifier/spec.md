---
type: spec
id: SPEC-drum-machine-groove-classifier
title: Drum machine groove-quality classifier
status: in-progress
owner: The Sourdaw team
sources:
  - ../drum-machine/spec.md
  - ../audio-generation-browser/research.md
  - ../workflow-ui/research.md
---

# Drum machine groove-quality classifier

## Intent

Score a candidate drum pattern's rhythmic quality and genre fit with a small CNN over mel
spectrograms of a short offline-rendered preview, surfacing an advisory "Groove Fit" chip and
feeding text-to-pattern ranking. Inference runs off the audio thread (Rust `ort` worker on native,
ONNX Runtime Web worker on web) and never modifies a pattern.

## Non-goals

- Generating patterns (`../drum-machine-text-to-pattern/spec.md`) or transferring groove
  (`../drum-machine-groove-templates/spec.md`).
- AI audio synthesis; cross-session preference learning.

## Requirements

### AC-001 — Classify pattern genre and quality from a rendered preview

The classifier must offline-render a 2–4 bar candidate pattern, compute a log-mel spectrogram
(22.05 kHz, 2048-FFT, 512-hop, 128 mels), and output a genre distribution plus a `[0,1]` quality
score.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_classifier_pipeline`

### AC-002 — Classification meets the accuracy and correlation bar

On a curated set of ≥50 hand-labelled patterns covering all classes, top-1 genre accuracy must be
≥70% and quality-score Spearman correlation with human ratings ≥0.5.

Verify with: `manual` — run the labelled eval set and confirm ≥70% top-1 accuracy and ≥0.5 Spearman

### AC-003 — Classification runs off the audio thread

Classification triggered during playback must leave the audio callback p99 run-time within ±10% of
a playback-only control.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_classifier_offthread`

### AC-004 — End-to-end latency stays within budget

A 2-bar classification must complete within 250 ms on the reference native target (500 ms on web).

Verify with: `manual` — time a 2-bar classification on the reference machine and confirm ≤250 ms native

### AC-005 — The Groove Fit chip is advisory only

The model must load lazily, showing a "warming up" state without blocking the sequencer.

Verify with: `pnpm test:run -- DrumMachine grooveFitChip`

### AC-006 — The Groove Fit chip never modifies a pattern

The Groove Fit chip must never modify a pattern.

Verify with: `pnpm test:run -- DrumMachine grooveFitChip`

## Open questions

- [ ] (non-blocking) Initial genre/groove label set — ships as an enumerated constant and evolves.

## Affected areas

- Rust `ort` worker (native) / ONNX Runtime Web worker (web)
- `resources/ai-models/` (model + per-file license metadata)
- sequencer header Groove Fit chip (Level 3+)

## Dropped from sources

- Exact CNN architecture — an implementation choice subject to the latency bar.
