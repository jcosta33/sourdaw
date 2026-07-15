---
type: spec
id: SPEC-rave-timbre-transfer
title: RAVE AI timbre transfer
status: draft
owner: The Sourdaw team
sources:
  - "Originating design note: RAVE timbre transfer (.agents/specs/rave-timbre-transfer/)"
  - ../dependency-boundary-validation/spec.md
---

# RAVE AI timbre transfer

## Intent

Morph a source clip's timbre toward a target clip using a RAVE encoder/decoder pair running
under `onnxruntime-web` in a Web Worker, rendering a new audio clip; a secondary monitor
mode streams a track through the model at higher latency for live auditioning.

## Non-goals

- Tauri-native ONNX inference (web-build parity is required; a native path is a later optimisation).
- Low-latency live RAVE playback (real-time mode is monitor-only, ~200 ms).
- Storing model weights in the project (models are a user-scoped cache, referenced by id).
- Syncing per-track real-time assignments across CRDT peers (they are local).

## Requirements

### AC-001 — Real ONNX encode/decode round-trip

`encodeAudioWithOnnx` → `decodeLatentWithOnnx` through a loaded model must reproduce an
identity model's input ramp within ±1e-3.

Verify with: `pnpm test:run -- rave`

### AC-002 — End-to-end transfer inserts a clip

`transferTimbreToClip` must render output and insert a new clip on the source track via the
existing clip-insertion path, honouring the `placement` mode.

Verify with: `pnpm test:run -- rave`

### AC-003 — Sample-rate reconciliation

Encoding 44.1 kHz samples for a 48 kHz model must resample so the produced latents have the
model-correct frame count.

Verify with: `pnpm test:run -- rave`

### AC-004 — Warm worker reuse

Two concurrent `ensureRaveWorker` calls for the same model must return the same worker.

Verify with: `pnpm test:run -- rave`

### AC-005 — Typed error paths

`MODEL_NOT_LOADED`, `SAMPLE_RATE_MISMATCH`, and `CLIP_NOT_AUDIO` must each surface as their
`RaveError` variant rather than throwing.

Verify with: `pnpm test:run -- rave`

### AC-006 — Real-time underrun degrades to silence

In monitor mode a stalled worker must produce silence (not crackle) and resume cleanly once
output is available again.

Verify with: `pnpm test:run -- rave`

### AC-007 — Settings persistence

Active model id, transfer blend, temperature, and real-time assignments must round-trip
across save and reload, while weights stay in the user cache.

Verify with: `pnpm test:run -- rave`

### AC-008 — RAVE module isolation

The feature must reach other modules only through their public surfaces (clip insertion,
audio buffer cache).

Verify with: `pnpm deps:validate`

### AC-009 — Model download-on-demand with consent and progress

A referenced model missing from the user cache must download on demand only after an explicit
user-consent prompt, reporting progress through `downloadModel(modelId, onProgress)` as
`raveDownloadModel` runs.

Verify with: `pnpm test:run -- rave`

### AC-010 — WebGPU-to-WASM-SIMD backend fallback with slow-path progress

When WebGPU is unavailable the runtime must fall back to WASM-SIMD and report progress on the
slow path (a 10 s source encodes in roughly 6–8 s on WASM).

Verify with: `pnpm test:run -- rave`

### AC-011 — Worker-crash and download-failure error variants

A crashed worker must surface as `WORKER_CRASHED` and a failed model download as
`MODEL_DOWNLOAD_FAILED`, each as its `RaveError` variant rather than throwing.

Verify with: `pnpm test:run -- rave`

### AC-012 — Encode performance budget

A mark-based benchmark must verify the mocked-model encode path handles 30 s of 44.1 kHz audio
in under 200 ms on the CI runner.

Verify with: `pnpm test:run -- rave`

### AC-013 — Command Palette entries

The Command Palette must expose `Rave: Transfer Selected Clips` and `Rave: Download Model <name>`.

Verify with: `pnpm test:run -- rave`

### AC-014 — Migration defaults for existing projects

Existing projects must default their RAVE settings to
`{ activeModelId: null, transferBlend: 0.5, temperature: 1.0, realTimeAssignments: [] }` via
`hydrateModuleStoresFromProjectData`.

Verify with: `pnpm test:run -- rave`

### AC-015 — Worker teardown cleans up

`terminateRaveWorker` must clean up the worker for a model.

Verify with: `pnpm test:run -- rave`

### AC-016 — RAVE inspector panel opens on clip selection

A RAVE inspector panel (`src/modules/Workspace/presentations/views/Inspector/RavePanel.tsx`)
must open when a clip is selected and the user switches to the RAVE tab.

Verify with: `pnpm test:run -- RavePanel`

### AC-017 — Model browser with factory list and custom import

The panel's model-browser column must list the 5 factory models, each showing a size badge and
its download/loaded state, and must provide an "Import custom .onnx" control for caching a
user-supplied model.

Verify with: `pnpm test:run -- RavePanel`

### AC-018 — Source and target clip assignment controls

The transfer controls must auto-set the source clip from the selected clip and allow
reassigning it by dragging in another clip, and must present a target-clip drop zone that
accepts either an arrangement clip reference or a file.

Verify with: `pnpm test:run -- RavePanel`

### AC-019 — Blend and temperature controls

The transfer controls must expose a blend slider spanning 0–100% that maps to `transferBlend`,
and a temperature slider spanning 0–2 that maps to `temperature`.

Verify with: `pnpm test:run -- RavePanel`

### AC-020 — Placement radio control

The transfer controls must offer a placement radio with options Replace / New track / New clip,
defaulting to New clip.

Verify with: `pnpm test:run -- RavePanel`

### AC-021 — Transfer button with staged progress

The Transfer button must trigger `raveTransferTimbre` and surface staged progress through
encode → transfer → decode → write.

Verify with: `pnpm test:run -- RavePanel`

### AC-022 — Real-time monitor controls shown when armed

The panel's real-time section must provide a "Live Monitor" toggle and a model selector, shown
only when the track is armed, carrying a warning label "~200 ms latency — monitor only".

Verify with: `pnpm test:run -- RavePanel`

### AC-023 — Live latency indicator in the UI

The UI must surface a prominent real-time latency indicator to the user (e.g. "Live: ~200 ms")
whenever monitor mode is active.

Verify with: `pnpm test:run -- RavePanel`

### AC-024 — Pure functions remain a model-free fallback for CI

The existing pure `encodeAudio`, `decodeLatent`, and `timbreTransfer` functions must remain
usable as a model-free fallback path when no model is loaded, so tests and CI can run the
pipeline end-to-end without downloading model weights.

Verify with: `pnpm test:run -- rave`

### AC-025 — Live monitoring rehydrates at boot

A `rehydrateRealTimeRave()` step must re-attach and restart live monitoring for persisted
per-track real-time assignments after the audio engine is ready and the project is loaded — not
merely round-trip the assignment data.

Verify with: `pnpm test:run -- rave`

### AC-026 — Latent interpolation fallback

The model-free RAVE fallback MUST retain `interpolateLatent` as a pure latent-space morph
primitive. For `time` in `[0, 1]`, `interpolateLatent(alpha, b, time)` MUST return a vector
with `alpha.values.length` values in source order, linearly blending each source value with
the corresponding `b.values` value (using `0` when that target dimension is absent), and
linearly blending `timeSec`; with equal-shaped vectors, `time = 0` and `time = 1` MUST return
the source and target vectors respectively. The function MUST NOT mutate either input.

Verify with: `pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/interpolateLatent.spec.ts`

## Current-state ownership

The four current `no-orphans` helpers are heuristic/test-only today and do not prove
model-backed AC-001 through AC-003:

- `src/modules/AudioEngine/useCases/rave/encodeAudio.ts`
- `src/modules/AudioEngine/useCases/rave/decodeLatent.ts`
- `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts`
- `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts`

Their sibling tests cover deterministic heuristics only. AC-024 intentionally owns the
future model-free fallback use of its named `encodeAudio`, `decodeLatent`, and
`timbreTransfer` helpers, while AC-026 owns `interpolateLatent` as the pure latent-space
interpolation primitive. This promotion retains all four helpers; it does not silently
authorize deletion or narrow either fallback contract. Any future retirement MUST name the
exact helper path and change its owning acceptance criterion.

## Constraints

- **Model-path resolution under Vite** — the `modelPath` strings in `FACTORY_MODELS` are
  relative (e.g. `models/rave/strings.onnx`) and must be resolved against
  `import.meta.env.BASE_URL` by a future RAVE-owned download implementation so model fetches
  work under a non-root deploy base; no RAVE-owned download implementation exists under
  `src/modules/AudioEngine/useCases/rave` at promotion SHA
  `078dfc3383760a01d219a04d735c7e8f74a0f820`. The existing BrowserAi owner at
  `src/modules/BrowserAi/useCases/downloadModel.ts` is unrelated and does not implement
  RAVE model-path resolution, so this is an unimplemented requirement, not a completed fix.
- **Model buffer memory management** — decoded audio buffers (≈5.3 MB per 30 s stereo at
  44.1 kHz) are the large objects in this pipeline and must be managed through the existing
  `audioBufferCache` LRU rather than retained unboundedly.

## Open questions

- [ ] Q-001 — Model hosting: bundle the default model and download-on-demand the rest, or
  require self-serve hosting for all five?
- [ ] Q-002 — Real-time block size vs latency trade-off (8192 frames ≈ 185 ms) — is the
  monitor-only positioning acceptable, or is a smaller block worth pursuing?
- [ ] Q-003 — Custom `.onnx` import: validation/limits before caching a user-supplied model.

## Affected areas

- `src/modules/AudioEngine/useCases/rave/` (ONNX encode/decode, transfer-to-clip, download)
- `src/modules/AudioEngine/services/` + `workers/` (worker host, RAVE worker, worklet bridge)
- `src/modules/AudioEngine/engine/TrackNode.ts` (`rave-realtime` device factory)
- `src/modules/Arrangement/` clip insertion + `audioBufferCache` (consumers)
- `src/modules/Command/` (RAVE AppActions + handlers); project persistence (`audioEngine.rave`)

## Dropped from sources

- Tauri-native inference — rejected for v1 to preserve web-build parity.
- Synced real-time assignments — intentionally local, not CRDT-shared.
- The session-by-session milestone breakdown (M1–M5) — delivery planning, not spec content.
