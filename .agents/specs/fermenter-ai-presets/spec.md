---
type: spec
id: SPEC-fermenter-ai-presets
title: Fermenter AI preset pipeline
status: draft
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/spec-of-the-gaps.md
---

# Fermenter AI preset pipeline

## Intent

Add an AI layer over Fermenter presets: score a rendered preset's musicality with
a small classifier, auto-tag it from audio features, generate a preset from a
text prompt, and morph between two presets. None of this is built yet.

## Non-goals

- The preset file format and browser (`../fermenter-presets/spec.md`).
- Training the classifier model — this spec covers inference and integration, not
  the offline training pipeline.

## Requirements

### AC-001 — The quality classifier scores a rendered preset from 64 features

When a preset is rendered, the classifier must extract the 64-feature spectral
vector and output a musicality score in `[0, 1]`.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::quality_classifier`

### AC-002 — Inference falls back when the ONNX runtime is unavailable

When the ONNX runtime is unavailable, scoring must degrade to a defined fallback
rather than failing the host.

Verify with: `pnpm test:run -- fermenterAiClassifierFallback`

### AC-003 — Auto-tagging maps audio features to tags by threshold

When a preset is analysed, the auto-tagger must assign tags from spectral
centroid, flux, RMS, and onset density via defined thresholds.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::auto_tagging`

### AC-004 — Text-to-preset output is validated and clamped to schema

When the LLM returns a preset JSON, the pipeline must validate it against the
preset schema and clamp out-of-range values before loading.

Verify with: `pnpm test:run -- fermenterTextToPreset`

### AC-005 — Preset morphing interpolates by parameter type

When two presets are morphed, continuous params must interpolate linearly,
frequency/Q params logarithmically, and discrete types must crossfade.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::preset_morph`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] Where does inference run on web — `onnxruntime-web` in a worker, or a
  server round-trip? Blocks `status: ready`.
- [ ] (non-blocking) What musicality-score threshold separates "good" from "bad"
  for browser surfacing (the source suggests 0.6)?

## Affected areas

- `crates/daw-dsp/src/fermenter/` (feature extraction, morphing)
- `src/modules/Fermenter/` (classifier inference, text-to-preset, tagging UI)

## Dropped from sources

- The offline training pipeline (1000 human-rated presets, augmentation) — out of
  scope; this spec assumes a trained model is supplied.
