---
type: spec
id: SPEC-browser-kokoro-tts
title: Browser Kokoro TTS vocal previews
status: in-progress
owner: The Sourdaw team
sources:
  - ../audio-generation-browser/research.md
---

# Browser Kokoro TTS vocal previews

## Intent

Generate natural spoken-voice scratch tracks from text in the browser using Kokoro-82M via
Transformers.js v3 (quantized ONNX on WebGPU), running in the `BrowserAi` ONNX worker. The output
is a rough vocal placeholder for composition — spoken, not sung — time-stretched to fit a song
region. This is Phase 2, building on the shared inference infrastructure.

## Non-goals

- Singing synthesis (that is `../browser-diffsinger-svs/spec.md`).
- Word-level synchronized alignment — only approximate region time-stretch in v1.
- Per-voice model downloads — all 21 voices share one model.

## Requirements

### AC-001 — Generate speech from text via Transformers.js

Kokoro must generate speech audio from a text string using `pipeline('text-to-speech', ...)` on
WebGPU, in the ONNX inference worker.

Verify with: `pnpm test:run -- BrowserAi renderKokoroTts`

### AC-002 — Voice selection changes the output

Selecting among at least three of the 21 voices via `speaker_id` must produce audibly different
output from the same text.

Verify with: `pnpm test:run -- BrowserAi kokoroVoiceSelection`

### AC-003 — Output is time-stretched to fit the region

The generated speech must be time-stretched to approximately fill a user-specified bar region.

Verify with: `pnpm test:run -- BrowserAi kokoroTimeStretch`

### AC-004 — Output is resampled to 44.1 kHz

Kokoro's 24 kHz output must be resampled to 44.1 kHz before entering the audio graph.

Verify with: `pnpm test:run -- BrowserAi resampleToDawRate`

### AC-005 — Model downloads with progress and persists

The Kokoro q8 model (~160 MB) must download with progress indication and reload from OPFS across
sessions.

Verify with: `pnpm test:run -- BrowserAi kokoroModelDownload`

### AC-006 — Inference keeps the UI responsive

Kokoro inference must run in the worker so the main thread stays responsive during generation.

Verify with: `manual` — generate a 3 s clip and confirm the UI does not stutter

## Open questions

- [ ] (non-blocking) Keep q8 as the default download, with q4 offered as a smaller alternative?
  Proposed: yes (q8 default for audio quality).

## Affected areas

- `src/modules/BrowserAi/useCases/renderKokoroTts`
- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts`
- `src/modules/BrowserAi/models/` (voice catalog)

## Dropped from sources

- Precise word-level timing alignment — future enhancement.
- `kokoro-js` wrapper — Transformers.js v3 is the chosen integration.
