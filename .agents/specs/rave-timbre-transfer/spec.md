---
type: spec
id: SPEC-rave-timbre-transfer
title: RAVE AI timbre transfer
status: draft
owner: The Sourdaw team
sources:
  - ../audio-generation/research.md
  - ../audio-generation/spec.md
  - ../dependency-boundary-validation/spec.md
  - ../../../src/modules/AudioEngine/useCases/rave/encodeAudio.ts
  - ../../../src/modules/AudioEngine/useCases/rave/decodeLatent.ts
  - ../../../src/modules/AudioEngine/useCases/rave/timbreTransfer.ts
  - ../../../src/modules/AudioEngine/useCases/rave/interpolateLatent.ts
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

### AC-002 — Loaded-model transfer inserts a clip

With a loaded model, `transferTimbreToClip` must render output and insert a new clip on the
source track through the existing clip-insertion path, honouring the `placement` mode.

Verify with: `pnpm test:run -- rave`

### AC-003 — Sample-rate reconciliation

Encoding 44.1 kHz samples for a 48 kHz model must resample so the produced latents have the
model-correct frame count.

Verify with: `pnpm test:run -- rave`

### AC-004 — Warm worker reuse

Two concurrent `ensureRaveWorker` calls for the same model must return the same worker.

Verify with: `pnpm test:run -- rave`

### AC-005 — `transferTimbreToClip` typed error contract

`transferTimbreToClip` MUST return one typed `RaveError` rather than throw, using this contract:

| Input condition | Result | Pure-helper behavior |
| --- | --- | --- |
| No model is loaded | `MODEL_NOT_LOADED` | No invocation of `encodeAudio`, `decodeLatent`, `timbreTransfer`, or `interpolateLatent` |
| Loaded model; invalid sample-rate input | `SAMPLE_RATE_MISMATCH` | Not applicable |
| Loaded model; invalid clip-type input | `CLIP_NOT_AUDIO` | Not applicable |

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
covering no-model, sample-rate, and clip-type error paths and asserting that no-model execution
does not invoke a pure helper.

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

The panel's model-browser column MUST list the 5 factory models, each with a size badge and its
download/loaded state, plus an "Import custom .onnx" control for caching a user-supplied model.

Verify with: `pnpm test:run -- RavePanel`

### AC-018 — Source and target clip assignment controls

The transfer controls MUST auto-set the source clip from the selected clip, permit reassignment by
dragging in another clip, and present a target-clip drop zone accepting an arrangement clip
reference or a file.

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

### AC-024 — Direct deterministic helpers are test-only

The current `encodeAudio.ts`, `decodeLatent.ts`, and `timbreTransfer.ts` files remain directly
callable only as deterministic CI/test helpers, while product transfer uses the loaded model path
and never silently calls these helpers. Future implementation MUST relocate each helper, with its
tests and observable contract preserved, to its exact corresponding
`src/modules/AudioEngine/useCases/rave/__tests__/helpers/` path before retiring the current
`useCases/rave` file; helper-test success and product reachability are not retirement conditions.

Verify with: `pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__` covering direct
calls to each named pure helper and the exact current-to-future path disposition.

### AC-025 — Live monitoring rehydrates at boot

A `rehydrateRealTimeRave()` step must re-attach and restart live monitoring for persisted
per-track real-time assignments after the audio engine is ready and the project is loaded — not
merely round-trip the assignment data.

Verify with: `pnpm test:run -- rave`

### AC-026 — Direct pure latent interpolation helper

The current `interpolateLatent.ts` file remains directly callable as a deterministic CI/test
latent-space primitive with this observable contract: for `time` in `[0, 1]`,
`interpolateLatent(alpha, b, time)` returns a vector with `alpha.values.length` values in source
order, linearly blending each source value with the corresponding `b.values` value (using `0`
when that target dimension is absent) and `timeSec`; equal-shaped endpoints return source/target
vectors and neither input is mutated. Future implementation MUST relocate it, with this contract
and its tests preserved, to
`src/modules/AudioEngine/useCases/rave/__tests__/helpers/interpolateLatent.ts` before retiring
the exact current file; direct helper success and product reachability do not retire the warning.

Verify with: `pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/interpolateLatent.spec.ts`
covering equal-shaped `time = 0` and `time = 1` endpoints including `timeSec`, missing target
dimensions defaulting to `0`, and deep-equality snapshots proving neither input is mutated.

### AC-027 — Model-backed transfer provenance

With a loaded model, `transferTimbreToClip` derives the rendered audio, cache entry, and
inserted clip bytes from the named worker's ONNX `encodeAudioWithOnnx` -> `decodeLatentWithOnnx`
result. The owning test MUST make that model result intentionally different from every pure-helper
result and assert that the inserted bytes equal the model result; pure-helper output is excluded
from model-backed transfer.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
asserting model-distinguishable bytes at render, cache, and insertion boundaries.

## Current-state ownership

The four current `no-orphans` paths are direct deterministic CI/test helpers only. Their green
tests are intentionally non-retiring and do not prove the model-backed product contracts in
AC-001 through AC-005 or AC-027:

| Current warning path | Current disposition | Required future helper path | Warning closes only when |
| --- | --- | --- | --- |
| `src/modules/AudioEngine/useCases/rave/encodeAudio.ts` | Direct deterministic test helper; retain now. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/encodeAudio.ts` | The exact current file is retired after relocation with tests/contract preserved, or an explicit superseding ADR names this exact path. |
| `src/modules/AudioEngine/useCases/rave/decodeLatent.ts` | Direct deterministic test helper; retain now. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/decodeLatent.ts` | The exact current file is retired after relocation with tests/contract preserved, or an explicit superseding ADR names this exact path. |
| `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts` | Direct deterministic test helper; retain now. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/timbreTransfer.ts` | The exact current file is retired after relocation with tests/contract preserved, or an explicit superseding ADR names this exact path. |
| `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts` | Direct deterministic test helper; retain now. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/interpolateLatent.ts` | The exact current file is retired after relocation with tests/contract preserved, or an explicit superseding ADR names this exact path. |

Direct helper availability, passing CI tests, and product reachability are not warning retirement
conditions. `AC-005` owns `MODEL_NOT_LOADED` with zero pure-helper calls; `AC-024` and `AC-026`
own the direct test contracts and exact relocation; `AC-027` owns model-result provenance. This
promotion retains all four current files and does not authorize a silent product fallback.

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
