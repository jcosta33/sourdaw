---
type: spec
id: SPEC-orchestra-ai-pipelines
title: Orchestra AI-assisted generation and scoring
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra AI-assisted generation and scoring

## Intent

Add AI assistance around Orchestra — template-driven preset/phrase generation,
text-to-preset, morphing between presets, and a render-quality classifier that
scores a patch and flags artifacts — running inference off the audio thread and
emitting only validated preset documents.

## Non-goals

- The preset format and versioned loading itself — owned by
  `SPEC-orchestra-presets`.
- AI generation of raw sample audio content (frontier asset work; see Open
  questions).
- The DAW-wide AI trust/policy model — owned by `SPEC-ai-trust-modes`.

## Requirements

### AC-001 — Generated presets validate against the preset schema

When the generator emits a preset (template-based or text-to-preset), the output
must validate against the current preset schema before it is offered to load.

Verify with: `pnpm test:run -- orchestraAiGeneratedPresetValid`

### AC-002 — Morphing interpolates between two valid presets

When morphing between two presets, the result at any interpolation point must be
a schema-valid preset blending their articulations, dynamics curves, and mic
mixes.

Verify with: `pnpm test:run -- orchestraPresetMorph`

### AC-003 — The quality classifier returns a score and an artifact-risk flag

When a rendered patch is scored, the classifier must return both a quality score
and an artifact-risk indicator from a mel-spectrogram of the render.

Verify with: `pnpm test:run -- orchestraQualityClassifier`

### AC-004 — Inference runs off the audio thread

When any model runs, inference must execute off the audio thread so audio
rendering is never blocked.

Verify with: `pnpm test:run -- orchestraInferenceOffThread`

## Open questions

- [ ] (blocking) Which generation surfaces ship first (templates and morphing)
  versus deferred (text-to-preset LLM, generative sample audio)? Scope must be
  fixed before build.
- [ ] (non-blocking) Native inference via the `ort`/ONNX path versus a browser
  inference path — one runtime or per-backend?

## Affected areas

- `src/modules/Levain/` (generation UI, classifier results surfacing)
- the AI inference path (ONNX/`ort` native, browser inference) feeding validated
  preset documents

## Dropped from sources

- AI-generated and resynthesized sample content (text-to-audio generation,
  resynthesis-as-new-content) — frontier asset strategy with legal/quality
  concerns; out of scope for the engine, surfaced as the blocking question.
- ONNX opset/versioning notes — implementation detail, not a requirement.
