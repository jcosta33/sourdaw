# BrowserAi module — Agent Guidelines

Client-side neural audio inference (DDSP instrument synthesis, Kokoro TTS, DiffSinger singing, RAVE neural audio), hardware capability probing (WebGPU/WASM), and local model artifact storage (OPFS/Cache API); does not own cloud LLM orchestration (AiRuntime), DAW project timeline data, or the live WebAudio graph (AudioEngine).

## Public Contract Surface

- `useCases`: `initBrowserAi`, `downloadModel`, `removeModel`, `downloadDdspInstrument`, `removeDdspInstrument`, `isDdspInstrumentId`, `getDdspPhraseId`, `markDdspPhraseStale`, `invalidateDdspPhraseIfSourceChanged`, `recordDdspPhraseSource`, `renderDdspInstrument`, `renderKokoroTts`, `renderDiffSingerPhrase`, `cancelRender`, `detectCapabilities`, `initRaveModels`, `isRaveModelPresent`, `KOKORO_MODEL_ENTRY`, `getRaveHandlers`.
- `stores`: `capabilityStore`, `modelRegistryStore`, `renderQueueStore`.
- `presentations/views`: `ModelManagerPanel`, `CapabilityReportPanel`, `KokoroVoiceSelector`, `AiRenderClipPreview`.
- `events`: None.
- Handlers: `getRaveHandlers`.

## Key Subsystems

- **Inference Worker Bridge**: Dedicated web workers (`repositories/inferenceWorkerBridge.ts`, `inference.worker.ts`) executing ONNX Runtime Web and TensorFlow.js models isolated from the UI thread.
- **Model Storage Worker**: OPFS / Cache API storage management (`repositories/modelStorageWorkerBridge.ts`, `modelStorage.worker.ts`) with SHA checksum validation and quota awareness.
- **Render Queue & Phrase Cache**: `stores/renderQueueStore.ts` tracks pending renders and caches phrase audio by source content hash.
- **Hardware Probing**: `repositories/capabilityDetector.ts` queries WebGPU adapter limits, floating-point texture support, and WASM SIMD features.

## Invariants & Traps

- All heavy ML model loading and neural inference MUST stay inside dedicated web workers — never instantiate ONNX or TFjs runtimes on the main UI thread or in AudioWorklet real-time callbacks.
- Cache keys for synthesized phrases must hash source pitch, velocity, timing, and phonemes to ensure changes invalidate cached audio.
- WebGPU models must fall back cleanly to WASM/CPU execution paths when WebGPU adapters or required device limits are unavailable.

## Verification

```bash
pnpm vitest run src/modules/BrowserAi
```
