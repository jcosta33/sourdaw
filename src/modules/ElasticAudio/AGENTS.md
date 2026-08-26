# ElasticAudio module — Agent Guidelines

Transient and warp marker orchestration: manages transient detection, warp marker editing/quantization, warp algorithm selection, and the elastic audio editor panel.

## Domain Ownership

Owns transient marker detection, warp marker editing/quantization, warp algorithm selection (`beats`, `tones`, `texture`, `repitch`, `complex`), and elastic audio editor panel state. Does not own low-level DSP time-stretch rendering kernels (AudioEngine/WASM) or audio clip timeline arrangements (Arrangement).

## Public Contract Surface

- **`useCases`**: `detectTransients`, `detectTransientsForClip`, `markElasticDetectionComplete`, `selectElasticMarkers`, `openElasticEditor`, `closeElasticEditor`, `setElasticTool`, `setElasticSensitivity`, `addManualMarker`, `removeMarker`, `toggleMarkerLock`, `quantizeTransients`, `enableWarping`, `setWarpAlgorithm`, `setPitchShift`, `setDefaultAlgorithm`, `getAlgorithmInfo`.
- **`stores`**: `elasticAudioStore` (`defaultElasticAudioState`, types `ElasticAudioState`, `ElasticEditorTool`), `audioWarpStore` (`DEFAULT_WARP_SETTINGS`, `WARP_ALGORITHMS`, types `WarpAlgorithm`, `WarpState`, `ClipWarpSettings`).
- **`presentations/views`**: `ElasticEditorPanel`.
- **`events`**: None.
- **Handler maps**: Handlers for elastic audio/warping actions live in `AudioEngine/handlers/finalFeature`.

## Key Subsystems

- **`stores/elasticAudio.ts`**: Active clip transient markers, detection lifecycle state, sensitivity threshold, marker selection/lock states, active editor tool (`warp`, `pencil`, `eraser`).
- **`stores/audioWarp.ts`**: Per-clip warp settings (algorithm, pitch shift semitones/cents, warp enabled, transient sensitivity).
- **`presentations/views/`**: `ElasticEditorPanel.tsx` interactive transient visualizer and marker manipulation surface.
- **`useCases/`**: Transient detection (`detectTransients.ts`, `detectTransientsForClip.ts`), marker manipulation (`addManualMarker.ts`, `removeMarker.ts`, `toggleMarkerLock.ts`, `quantizeTransients.ts`), and warp configuration (`enableWarping.ts`, `setWarpAlgorithm.ts`, `setPitchShift.ts`).

## Invariants & Traps

- **Non-destructive transient metadata**: Transient markers and warp points are metadata projections on audio clips; original PCM audio in `audioBufferCache` is never mutated.
- **Locked marker protection**: Locked warp markers cannot be moved or auto-quantized; transient quantization operations must respect marker lock flags.
- **Dynamic sensitivity filtering**: Transient detection adjusts displayed and active markers dynamically according to sensitivity (0–100%) without re-executing raw onset detection.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/ElasticAudio`
- **Module boundaries**: `pnpm deps:validate`
