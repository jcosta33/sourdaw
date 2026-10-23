# ElasticAudio module — Agent Guidelines

Transient and warp marker orchestration: manages transient detection, warp marker editing/quantization, warp algorithm selection, and the elastic audio editor panel.

## Domain Ownership

Owns transient marker detection, warp marker editing/quantization, warp algorithm selection (`repitch`, `phase-vocoder`, `wsola` — the canonical ADR 0024 surface over the three executors), and elastic audio editor panel state. Does not own low-level DSP time-stretch rendering kernels (AudioEngine/WASM) or audio clip timeline arrangements (Arrangement).

## Public Contract Surface

- **`useCases`**: `detectTransients`, `detectTransientsForClip`, `markElasticDetectionComplete`, `selectElasticMarkers`, `openElasticEditor`, `closeElasticEditor`, `setElasticTool`, `setElasticSensitivity`, `addManualMarker`, `removeMarker`, `toggleMarkerLock`, `quantizeTransients`, `enableWarping`, `setWarpAlgorithm`, `setPitchShift`, `setDefaultAlgorithm`, `getAlgorithmInfo`.
- **`stores`**: `elasticAudioStore` (`defaultElasticAudioState`, types `ElasticAudioState`, `ElasticEditorTool`), `audioWarpStore` (`DEFAULT_WARP_SETTINGS`, `WARP_ALGORITHMS`, types `WarpAlgorithm`, `WarpState`, `ClipWarpSettings`).
- **`presentations/views`**: `ElasticEditorPanel`.
- **`events`**: None.
- **Handler maps**: Handlers for elastic audio/warping actions live in `AudioEngine/handlers/finalFeature`.

## Key Subsystems

- **`stores/elasticAudio.ts`**: Open clip, detection lifecycle state, marker selection, and active editor tool. Last-used detection sensitivity belongs to the client-local Preferences store, not this session store.
- **`stores/audioWarp.ts`**: Per-clip warp settings (algorithm, pitch shift semitones/cents, warp enabled, transient sensitivity).
- **`presentations/views/`**: `ElasticEditorPanel.tsx` interactive transient visualizer and marker manipulation surface.
- **`useCases/`**: Transient detection (`detectTransients.ts`, `detectTransientsForClip.ts`), marker manipulation (`addManualMarker.ts`, `removeMarker.ts`, `toggleMarkerLock.ts`, `quantizeTransients.ts`), and warp configuration (`enableWarping.ts`, `setWarpAlgorithm.ts`, `setPitchShift.ts`).

## Invariants & Traps

- **Non-destructive transient metadata**: Transient markers and warp points are metadata projections on audio clips; original PCM audio in `audioBufferCache` is never mutated.
- **Locked marker protection**: Locked warp markers cannot be moved or auto-quantized; transient quantization operations must respect marker lock flags.
- **Sensitivity re-detection**: Changing sensitivity writes the canonical user preference and re-runs transient detection for an open clip after a 150 ms debounce. The first user-triggered detection for another clip reads that preference; selecting a clip alone does not detect.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/ElasticAudio`
- **Module boundaries**: `pnpm deps:validate`
