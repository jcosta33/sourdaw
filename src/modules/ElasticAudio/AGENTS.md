# ElasticAudio module — Agent Guidelines

Transient and warp marker orchestration: manages transient detection, warp marker editing/quantization, warp algorithm selection, and the elastic audio editor panel.

## Domain Ownership

Owns transient marker detection, warp marker editing/quantization, warp algorithm selection (`repitch`, `phase-vocoder`, `wsola` — the canonical ADR 0024 surface over the three executors), and elastic audio editor panel state. Does not own low-level DSP time-stretch rendering kernels (AudioEngine/WASM) or audio clip timeline arrangements (Arrangement).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`, `presentations/views/index.ts`. Handlers for elastic audio/warping actions live in `AudioEngine/handlers/finalFeature`, not here. `quantizeTransients` is Arrangement's executable command (it cuts and moves clips); `useCases/quantizeTransients.ts` only dispatches it with the editor's snap grid and sensitivity.

## Key Subsystems

- **`stores/elasticAudio.ts`**: Open clip, detection lifecycle state, marker selection, and active editor tool. Last-used detection sensitivity belongs to the client-local Preferences store, not this session store.
- **`stores/audioWarp.ts`**: Per-clip warp settings (algorithm, pitch shift semitones/cents, warp enabled, transient sensitivity).
- **`presentations/views/`**: `ElasticEditorPanel.tsx` interactive transient visualizer and marker manipulation surface.
- **`useCases/`**: Transient detection (`detectTransients.ts`, `detectTransientsForClip.ts`), marker manipulation (`addManualMarker.ts`, `removeMarker.ts`, `toggleMarkerLock.ts`), the transient quantize dispatcher (`quantizeTransients.ts`), and warp configuration (`enableWarping.ts`, `setWarpAlgorithm.ts`, `setPitchShift.ts`).

## Invariants & Traps

- **Non-destructive transient metadata**: Transient markers and warp points are metadata projections on audio clips; original PCM audio in `audioBufferCache` is never mutated.
- **Locked marker protection**: Locked warp markers cannot be moved or auto-quantized by marker edits.
- **The onset detector is shared**: `#/utils/transientOnsetDetection` is the one detector the onset worker, marker detection and Arrangement's transient quantize all run, so a marker the editor shows and a cut the quantize makes come from the same analysis.
- **Sensitivity re-detection**: Changing sensitivity writes the canonical user preference and re-runs transient detection for the displayed audio clip after a 150 ms debounce. An explicitly open clip takes precedence over selection. A pending gesture cannot mutate a changed clip, source, or project root; selecting a clip alone does not detect.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

- **Focused unit tests**: `pnpm guard --profile focused -- pnpm test:run <changed-spec>`
- PR CI checks module boundaries; inspect that result after cross-module changes.
