# RAVE — AI Timbre Transfer

## Goal

The user drops a target tone (a flute loop) onto a source clip (their vocal take), picks a blend amount, clicks Transfer, and the source clip is rendered to a new audio clip whose timbre has been morphed toward the target — voice that sings like a flute. Secondary: a real-time mode routes the currently-playing track's audio through the RAVE encoder/decoder pair so the user can monitor the effect live while recording.

## Current state

The pipeline is built up to the point where a caller only needs to supply actual model weights and a UI. All DSP primitives are pure functions with tests.

What exists:

- `src/modules/AudioEngine/stores/rave.ts` — `RaveModel`, `LatentVector`, `RaveState`, `raveStore`, `FACTORY_MODELS` (5 presets with `modelPath: 'models/rave/<name>.onnx'` strings, **paths do not resolve to real files today**).
- `src/modules/AudioEngine/useCases/rave/encodeAudio.ts` — simulated encoder using a windowed dot product with sines; input `Float32Array` → `LatentVector[]`. Not real inference.
- `src/modules/AudioEngine/useCases/rave/decodeLatent.ts` — simulated decoder, additive sines from latent values.
- `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts`, `timbreTransfer.ts`, `randomizeLatent.ts` — all pure, correct.
- `loadModel.ts`, `unloadModel.ts`, `registerFactoryModels.ts`, `setTemperature.ts`, `setTransferBlend.ts`, `toggleRealTime.ts` — store mutators.

What is missing:

- No ONNX runtime wired. `encodeAudio`/`decodeLatent` return plausible shapes but the audio is synthetic.
- No UI — no panel, no button, no drag target.
- No wiring to clip → render output. The result of `timbreTransfer()` never reaches `audioBufferCache` or a new clip.
- No AppActions or handlers.
- Real-time mode flag exists in store but is not connected to any `AudioWorkletNode`.
- No model files in `public/models/rave/`. No model-download flow.

## Design

### Runtime choice: `onnxruntime-web` with WebGPU backend

Offline (batch) inference runs in a dedicated Web Worker using `onnxruntime-web` with WebGPU when available, WASM-SIMD as fallback. The model files (`*.onnx`, ~28–60 MB each per `FACTORY_MODELS`) are lazy-fetched from `/models/rave/` and cached in the browser's Cache Storage keyed by the file SHA.

Real-time inference does **not** use ORT-Web: latency is too high for a WebAudio worklet (ORT inference is ~40–120 ms per 2048-frame block on WebGPU today, and the worklet must run in ≤2.9 ms). Real-time mode instead uses a streaming mode where ORT runs in a worker at a larger block size (e.g. 8192 frames, ~185 ms @ 44.1 kHz) and the result is played back with one buffer of latency — acceptable for monitoring while tracking, not acceptable for live playback. A prominent "Live: ~200 ms" indicator is shown in the UI.

Tauri-side inference is **rejected** because the pipeline must work in the pure-web build for parity with the existing `webdaw` target. Future optimisation: a native `onnxruntime` Tauri command could be added later with no API change.

### Encode / decode pipeline

```
  source clip (audioBufferId) ─► encodeAudioWithOnnx ─► latentsSrc (N frames × latentDim)
  target clip (audioBufferId) ─► encodeAudioWithOnnx ─► latentsTgt
                                                             │
                                        blend, temperature   │
                                                             ▼
                                               timbreTransfer(latentsSrc, latentsTgt, blend)
                                                             │
                                                             ▼
                                            decodeLatentWithOnnx ─► Float32Array samples
                                                             │
                                                             ▼
                                   write to audioBufferCache ─► new Clip on selected track
```

The existing pure `encodeAudio`, `decodeLatent`, `timbreTransfer` functions stay as **fallbacks** when no model is loaded (useful for tests and CI where model download is undesirable). A new pair `encodeAudioWithOnnx`, `decodeLatentWithOnnx` is added.

### Worker architecture

```
 main thread                         rave-worker
 ───────────                         ───────────
 transferTimbre(src, tgt, blend) ──► onmessage 'encode' { buffer, sampleRate }
                                       │
                                       ▼
                                     ORT session.run (encoder)
                                       │
                                       ▼
 ◄── 'encoded' { latents } ─────────── postMessage(latents, [latents.buffer])
 transfer blend in main …
 ──► onmessage 'decode' { latents } ──► ORT session.run (decoder)
 ◄── 'decoded' { samples } ─────────── postMessage(samples, [samples.buffer])
```

One worker per model family (strings, vocals, …). Workers are kept warm once loaded to avoid a 1–2 s ORT session init each render.

## API surface

```ts
// src/modules/AudioEngine/useCases/rave/encodeAudioWithOnnx.ts
export async function encodeAudioWithOnnx(
    samples: Float32Array,
    sampleRate: number,
    modelId: string
): Promise<Result<LatentVector[], RaveError>>;

// src/modules/AudioEngine/useCases/rave/decodeLatentWithOnnx.ts
export async function decodeLatentWithOnnx(
    vectors: LatentVector[],
    modelId: string
): Promise<Result<Float32Array, RaveError>>;

// src/modules/AudioEngine/useCases/rave/transferTimbreToClip.ts
/**
 * End-to-end: take a source and target clip, render a new clip on the
 * source track whose timbre is the source's morphed toward the target.
 * Commits via `executeAppAction({ type: 'insertClipFromBuffer', ... })`.
 */
export async function transferTimbreToClip(args: {
    sourceClipId: string;
    targetClipId: string;
    blend: number; // 0..1
    modelId: string;
    placement: 'replace' | 'newTrack' | 'newClip'; // default 'newClip'
}): Promise<Result<{ newClipId: string; bufferId: string }, RaveError>>;

// src/modules/AudioEngine/services/raveWorkerHost.ts
export function ensureRaveWorker(modelId: string): Promise<Worker>;
export function terminateRaveWorker(modelId: string): void;

// src/modules/AudioEngine/useCases/rave/downloadModel.ts
export async function downloadModel(
    modelId: string,
    onProgress?: (pct: number) => void
): Promise<Result<void, RaveError>>;
// loadModel() stays as the store-side flip; downloadModel() is the network fetch.

// src/modules/AudioEngine/useCases/rave/startRealTimeRave.ts
export async function startRealTimeRave(trackId: string, modelId: string): Promise<Result<void, RaveError>>;
export async function stopRealTimeRave(trackId: string): Promise<void>;

// New AppActions in src/modules/Command/models/AppAction.ts
type RaveActions =
    | { type: 'raveDownloadModel'; payload: { modelId: string } }
    | { type: 'raveLoadModel'; payload: { modelId: string } }
    | { type: 'raveUnloadModel'; payload: { modelId: string } }
    | {
          type: 'raveTransferTimbre';
          payload: {
              sourceClipId: string;
              targetClipId: string;
              blend: number;
              modelId: string;
              placement?: 'replace' | 'newTrack' | 'newClip';
          };
      }
    | { type: 'raveStartRealTime'; payload: { trackId: string; modelId: string } }
    | { type: 'raveStopRealTime'; payload: { trackId: string } }
    | { type: 'raveSetBlend'; payload: { blend: number } }
    | { type: 'raveSetTemperature'; payload: { temperature: number } };

// Error type
export type RaveError =
    | { code: 'MODEL_NOT_LOADED' }
    | { code: 'MODEL_DOWNLOAD_FAILED'; cause: unknown }
    | { code: 'CLIP_NOT_AUDIO'; clipId: string }
    | { code: 'WORKER_CRASHED'; cause: unknown }
    | { code: 'SAMPLE_RATE_MISMATCH'; expected: number; got: number };
```

## UI / UX

- **RAVE panel** — new inspector panel at `src/modules/Workspace/presentations/views/Inspector/RavePanel.tsx`. Opens when a clip is selected and the user switches to the RAVE tab.
- **Model browser** — left column: 5 factory models with size badge, download / loaded state, and an "Import custom .onnx" button.
- **Transfer controls** — middle column:
    - Source clip: auto-set from selected clip; user can reassign by dragging another clip in.
    - Target clip: drop zone that accepts an arrangement clip reference or a file.
    - Blend slider (0–100%, maps to `transferBlend`).
    - Temperature slider (0–2, `temperature`).
    - Placement radio: Replace / New track / New clip (default).
    - **Transfer** button — triggers `raveTransferTimbre`. Shows progress (encode → transfer → decode → write).
- **Real-time section** — right column: toggle "Live Monitor" + model selector. Warning label "~200 ms latency — monitor only". Shown only when the track is armed.
- **Command Palette entries** — `Rave: Transfer Selected Clips`, `Rave: Download Model <name>`.

## Data model / persistence

Add to `ProjectData.audioEngine`:

```ts
type ProjectData = {
    // ...
    audioEngine?: {
        rave?: {
            activeModelId: string | null;
            transferBlend: number; // last used
            temperature: number;
            /** per-track real-time assignments that survive reload */
            realTimeAssignments: Array<{ trackId: string; modelId: string }>;
        };
    };
};
```

**Model files are never stored in the project** — they are a user-scoped cache in `Cache Storage` at `rave-models-v1`. A project specifies a `modelId` by reference; if missing on the loading client, `raveDownloadModel` runs with user consent.

Real-time assignments rehydrate at boot via a new `rehydrateRealTimeRave()` called after the audio engine is ready and the project is loaded.

Migration: add the optional field. Existing projects default to `{ activeModelId: null, transferBlend: 0.5, temperature: 1.0, realTimeAssignments: [] }` via `hydrateModuleStoresFromProjectData`.

## Integration points

- `src/modules/AudioEngine/repositories/audioDecoding/` — reuses the existing decode pipeline to get `Float32Array` from `audioBufferId`. No new decoder.
- `src/modules/Arrangement/useCases/insertClipFromBuffer.ts` — existing helper that accepts a `Float32Array` + track → creates a clip. `transferTimbreToClip` calls this with the decoded output.
- `src/modules/AudioEngine/services/audioBufferCache.ts` — new buffers registered with content hash; normal freeze/undo applies.
- `src/modules/AudioEngine/engine/TrackNode.ts` — adds a device type `'rave-realtime'` handled in `DEVICE_FACTORIES`. Its factory returns an `AudioWorkletNode` backed by an `onnxruntime-web` streaming bridge. The worker runs ORT, the worklet only shuttles buffers via `MessagePort`.
- `src/modules/Command/useCases/executeAppAction.ts` — routes the 8 new action types.
- `src/modules/AudioEngine/handlers/` — new `raveFeature/` handler directory with one handler per action.
- `vite.config.ts` — add `onnxruntime-web` to the optimizer include list and ensure its WASM / WebGPU shader assets are copied to `/dist/ort/`.
- `package.json` — add `onnxruntime-web` (runtime dep). No Tauri-side change for v1.

## Risks / open questions

- **Model provenance** — factory models need real weights. Open question: host them on the Sourdaw CDN or require self-serve? Recommendation: ship `rave-synth.onnx` (~30 MB) as a bundled asset for the default experience; the other four are download-on-demand.
- **Sample-rate mismatch** — each RAVE model is trained at a specific rate (48 kHz or 44.1 kHz per `FACTORY_MODELS`). If the project rate differs, resample before encode and after decode. Use `AudioBuffer` resampling via `OfflineAudioContext`. Add to `encodeAudioWithOnnx`.
- **WebGPU availability** — not all browsers. Fallback to WASM-SIMD. On fallback, a 10-second source takes ~6–8 s to encode on a 2020 laptop (measured on comparable models). UI must show progress.
- **Memory** — a latent-vector array for a 30 s clip at 50 Hz rate × latentDim 32 = 48 kB. Fine. The audio buffer is the big object — decode output is ~5.3 MB / 30 s stereo 44.1. Manage via the existing `audioBufferCache` LRU.
- **Real-time jitter** — the 8192-frame block size means ~185 ms latency. If the worker stalls (GC, GPU submission), the audio path must glitch gracefully (continue at 0 gain, not crackle). The worklet maintains a silence-fallback ring buffer.
- **Model import path** — `modelPath` strings in `FACTORY_MODELS` are relative (`models/rave/strings.onnx`). With Vite this must be resolved via `import.meta.env.BASE_URL`. Fix in `downloadModel.ts`.
- **CRDT and real-time assignments** — two peers have different RAVE assignments. Decision: real-time assignments are **local**, not synced. They live in `audioEngine.rave.realTimeAssignments` but only in the per-user local settings branch (there is already a split for device assignments; reuse).

## Milestones

### M1 — Real ONNX encode/decode in worker (one session)

- Add `onnxruntime-web` dependency.
- Add `src/modules/AudioEngine/services/raveWorkerHost.ts` + worker source at `src/modules/AudioEngine/workers/raveWorker.ts`.
- Implement `encodeAudioWithOnnx` and `decodeLatentWithOnnx` with a mocked 8-dim identity model (checked-in tiny .onnx for tests) so the pipeline works end-to-end with a real ORT session.
- Retain existing pure fallbacks behind a feature flag for CI.

### M2 — Transfer pipeline + clip insertion (one session)

- `transferTimbreToClip` implementation with `placement` handling.
- AppActions and handlers for `raveTransferTimbre`, `raveLoadModel`, `raveUnloadModel`, `raveDownloadModel`.
- Writes to `audioBufferCache`, creates clip via `insertClipFromBuffer`, undoable.

### M3 — UI panel + model browser (one session)

- `RavePanel.tsx` with model browser, transfer controls, drop zones.
- Progress bar wired to worker message stream.
- Command Palette entries.

### M4 — Real-time mode (one session)

- `rave-realtime` device type factory in `TrackNode.addDevice`.
- `startRealTimeRave` / `stopRealTimeRave` + AppActions.
- Worklet ring-buffer fallback on jitter.
- Latency indicator in UI.

### M5 — Persistence + model cache (one session)

- `ProjectData.audioEngine.rave` schema + hydration.
- Cache Storage wrapper for model weights, progress events, user-confirm download prompt.
- Custom `.onnx` import (drop a file → stored in Cache Storage under a user-supplied id).

## Tests

- **Unit** — keep existing pure-function specs. Add `encodeAudioWithOnnx.spec.ts` / `decodeLatentWithOnnx.spec.ts` using a tiny checked-in identity model. Assert: identity roundtrip of a ramp signal within ±1e-3.
- **Integration** — `transferTimbreToClip.spec.ts`: given two fixture clips, run end-to-end with a mocked worker that returns known latents; assert a new clip is inserted on the selected track with the expected length.
- **Resample** — `encodeAudioWithOnnx` called with 44.1 kHz samples for a 48 kHz model produces latents of the correct frame count.
- **Worker host** — `raveWorkerHost.spec.ts`: two concurrent `ensureRaveWorker('rave-strings')` calls return the same Worker. `terminateRaveWorker` cleans up.
- **Real-time** — using an offline `AudioContext` with a mock ORT worker that delays 50 ms, schedule a 2-second source and assert: (a) output is non-zero after the initial latency gap, (b) underrun causes silence, not crackle.
- **Persistence** — save/load round trip: real-time assignments survive, transfer blend survives, active model id survives.
- **Error paths** — MODEL_NOT_LOADED, SAMPLE_RATE_MISMATCH, CLIP_NOT_AUDIO each produce the correct `RaveError` variant and a user-facing notification.
- **Performance budget** — mark-based benchmark that verifies the mocked-model encode path handles 30 s of 44.1 kHz audio in <200 ms on the CI runner.
