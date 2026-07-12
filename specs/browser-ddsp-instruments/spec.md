---
type: spec
id: SPEC-browser-ddsp-instruments
title: Browser DDSP instrument synthesis
status: in-progress
owner: The Sourdaw team
sources:
  - ../audio-generation-browser/research.md
---

# Browser DDSP instrument synthesis

## Intent

Synthesize monophonic instrument audio (violin, flute, trumpet, and up to 13 instruments) from
MIDI in the browser via TensorFlow.js running in a lazily-spawned worker, building on the
`BrowserAi` inference infrastructure. This is Phase 1 — the simplest, fastest, proven model — and
it proves the worker/session/cache pipeline that DiffSinger later reuses. A non-ML SoundFont path
is the always-available baseline that DDSP enhances.

## Non-goals

- Polyphonic DDSP — DDSP is monophonic by design.
- ONNX-based DDSP — no validated ONNX export exists; TF.js is the runtime.
- The shared inference infrastructure itself (see `../audio-generation-browser/spec.md`).

## Requirements

### AC-001 — Render monophonic instrument audio from MIDI

At least three DDSP instruments (violin, flute, trumpet) must load and render a monophonic MIDI
melody to audio recognizable as that instrument at the input pitches via TensorFlow.js.

Verify with: `pnpm test:run -- BrowserAi renderDdspInstrument`

### AC-002 — MIDI converts to frame-level pitch and loudness

MIDI notes must convert to 250 Hz pitch (note→Hz, rests→0) and loudness (velocity→dB) frame
sequences feeding the decoder in synthesis-only mode.

Verify with: `pnpm test:run -- BrowserAi midiToDdspInput`

### AC-003 — SoundFont baseline is the always-available fallback

Every MIDI track must retain a zero-download SoundFont playback path used automatically when a
DDSP model is absent or inference is unavailable.

Verify with: `pnpm test:run -- BrowserAi soundfontFallback`

### AC-004 — Output is resampled to 44.1 kHz

DDSP output (16 kHz native) must be resampled to 44.1 kHz before it enters the audio graph.

Verify with: `pnpm test:run -- BrowserAi resampleToDawRate`

### AC-005 — Models download on first use and persist

Instrument models (~10–25 MB) must download on first use with progress and reload from OPFS
across page reloads.

Verify with: `pnpm test:run -- BrowserAi ddspModelDownload`

### AC-006 — TF.js worker is lazily spawned and released

The TF.js worker must spawn only when a DDSP instrument is first used and be released when no
DDSP sessions remain.

Verify with: `pnpm test:run -- BrowserAi tfjsWorkerLifecycle`

### AC-007 — Render stays responsive and fast

A 4-bar phrase at 120 BPM must render in under 2 seconds on Chrome + WebGPU on a 2023 laptop
without blocking the main thread.

Verify with: `manual` — render a 4-bar phrase and confirm <2 s with no UI frame drops

## Open questions

- [ ] (non-blocking) Should the static instrument catalog ship as a bundled JSON, with models
  fetched on demand? Proposed: yes.

## Affected areas

- `src/modules/BrowserAi/useCases/renderDdspInstrument`
- `src/modules/BrowserAi/workers/tfjsInferenceWorker.ts`
- `src/modules/BrowserAi/models/` (instrument catalog)

## Dropped from sources

- Polyphonic instruments and 48 kHz extended models — out of scope.
- ONNX conversion of DDSP via the PyTorch reimplementation — unvalidated, deferred.
