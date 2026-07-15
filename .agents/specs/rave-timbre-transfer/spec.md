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
  - ../../../src/modules/AudioEngine/stores/rave.ts
  - ../../../src/modules/AudioEngine/useCases/rave/loadModel.ts
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

## Current state

No loaded-model AudioEngine/ONNX transfer path exists today. The current `loadModel.ts` only
marks a model `loaded` and records `activeModelId` in `raveStore`; it does not fetch model bytes,
create an ONNX session or worker, or enable `transferTimbreToClip`. The four warning paths named
under Current-state ownership are directly callable deterministic test helpers, not a product
transfer implementation. The store flag is not the verified session capability defined by AC-028.
Every model-backed requirement below is future work.

## Requirements

### AC-001 — Real ONNX encode/decode round-trip

The future `encodeAudioWithOnnx` → `decodeLatentWithOnnx` path through a genuinely loaded model as
defined by AC-028 MUST reproduce an identity model's input ramp within ±1e-3.

Verify with: `pnpm test:run -- rave`

### AC-002 — Loaded-model transfer inserts a clip

A future `transferTimbreToClip` invocation carrying the verified AC-028 session capability, matched
to the host-owned transfer selection under AC-029, MUST render output from only AC-030/AC-031-valid
worker responses and insert a new clip on the source track through the existing clip-insertion
path, honouring the `placement` mode.

Verify with: `pnpm test:run -- rave`

### AC-003 — Sample-rate reconciliation

Encoding 44.1 kHz samples for a 48 kHz model must resample so the produced latents have the
model-correct frame count.

Verify with: `pnpm test:run -- rave`

### AC-004 — Warm worker reuse

Two concurrent `ensureRaveWorker` calls MUST coalesce only when both `modelId` and the SHA-256
`modelDigest` of the selected model bytes match; a different digest is a different session key.

Verify with: `pnpm test:run -- rave`

### AC-005 — `transferTimbreToClip` typed error contract

The future `transferTimbreToClip` MUST return one typed `RaveError` rather than throw, using this
contract:

| Input condition | Result | Required effect boundary |
| --- | --- | --- |
| No verified AC-028 session capability, including store-flag-only, deterministic-shim, fake-worker, tampered-binding, or fabricated-capability input | `MODEL_NOT_LOADED` | No pure-helper invocation and no worker/session request |
| Verified capability/session does not match the AC-029 host-owned transfer selection | `MODEL_SESSION_MISMATCH` | No worker request, render, cache write, or clip insertion |
| Verified matched session; invalid sample-rate input | `SAMPLE_RATE_MISMATCH` | No worker request, render, cache write, or clip insertion |
| Verified matched session; invalid clip-type input | `CLIP_NOT_AUDIO` | No worker request, render, cache write, or clip insertion |
| Worker response has no outstanding request | `WORKER_RESPONSE_STALE` | No response acceptance, render, cache write, or clip insertion |
| Worker response reuses a consumed request | `WORKER_RESPONSE_DUPLICATE` | No additional response acceptance, render, cache write, or clip insertion |
| Worker response fields do not match the outstanding request's session, phase, model identity, or digest | `WORKER_RESPONSE_MISMATCH` | No response acceptance, render, cache write, or clip insertion |
| Worker response is malformed or contains a non-finite numeric value | `WORKER_RESPONSE_INVALID` | No response acceptance, render, cache write, or clip insertion |
| Worker response exceeds an AC-031 host-owned payload bound | `WORKER_RESPONSE_TOO_LARGE` | No response acceptance, render, cache write, or clip insertion |

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
covering every table row. No-model execution invokes neither a pure helper nor a worker/session;
flag-only, deterministic-shim, fake-worker, tampered-binding, and fabricated-capability cases each
return `MODEL_NOT_LOADED`. Every selection or response rejection occurs before the listed effects.

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

The panel's model-browser column MUST list the 5 factory models, each with a size badge, separate
download/cache and verified AC-028 session states, plus an "Import custom .onnx" control for
caching a user-supplied model. A store flag alone is never presented as a loaded session.

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

### AC-024 — Direct encode helper remains test-only

No loaded-model product transfer exists today. The current `encodeAudio.ts` MUST remain a direct
deterministic test helper until it is relocated, with its direct behavioral test and observable
contract preserved, to
`src/modules/AudioEngine/useCases/rave/__tests__/helpers/encodeAudio.ts` and the exact current path
is removed in the same change. Its current test directly covers empty/short input, frame count,
latent dimension, `timeSec`, and finite output. Product reachability and a green test alone do not
retire the warning; an ADR branch is valid only under
[dependency-boundary-validation AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement).

Verify with: `pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/encodeAudio.spec.ts`,
exact current/future path searches, and `pnpm deps:validate`

### AC-025 — Live monitoring rehydrates at boot

A `rehydrateRealTimeRave()` step must re-attach and restart live monitoring for persisted
per-track real-time assignments after the audio engine is ready and the project is loaded — not
merely round-trip the assignment data.

Verify with: `pnpm test:run -- rave`

### AC-026 — Direct pure latent interpolation helper

The current `interpolateLatent.ts` file MUST remain a directly callable deterministic CI/test
latent-space primitive until its complete direct test is green and the same change either performs
the exact relocation/removal below or satisfies
[dependency-boundary-validation AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement).
Its observable contract for `time` in `[0, 1]` is:
`interpolateLatent(alpha, b, time)` returns a vector with `alpha.values.length` values in source
order, linearly blending each source value with the corresponding `b.values` value (using `0`
when that target dimension is absent) and `timeSec`; equal-shaped endpoints return source/target
vectors and neither input is mutated. The current test proves only one midpoint and one missing
target-dimension case; it does not prove either endpoint or input immutability and is not relocation
or retirement evidence. The exact relocation preserves this contract at
`src/modules/AudioEngine/useCases/rave/__tests__/helpers/interpolateLatent.ts` and removes the
current file. Direct helper success and product reachability do not retire the warning.

Verify with: the strengthened
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/interpolateLatent.spec.ts` covering
equal-shaped `time = 0` and `time = 1` endpoints including `timeSec`, missing target dimensions
defaulting to `0`, and deep-equality snapshots proving neither input is mutated, followed by exact
path searches and `pnpm deps:validate`

### AC-027 — Model-backed transfer provenance

A future `transferTimbreToClip` invocation with the verified AC-028 session capability matched to
the AC-029 host-owned selection MUST derive its rendered audio, cache entry, and inserted clip bytes
from AC-030-correlated, AC-031-validated encode/decode responses produced by that capability's named
worker and worker-owned `onnxruntime-web` session. The owning test observes the verified session
receive both encode and decode, makes its result intentionally different from every pure-helper
result, and proves the rendered, cached, and inserted bytes equal the accepted session result;
pure-helper output cannot satisfy model-backed transfer.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
asserting the verified session's encode/decode calls, accepted response correlation, and
model-distinguishable bytes at render, cache, and insertion boundaries.

### AC-028 — Verified ONNX session capability

A future model-backed transfer MUST accept a model as genuinely loaded only through an opaque,
unforgeable, non-serializable `RaveSessionCapability` issued by the trusted RAVE worker host after
the named worker successfully initializes an `onnxruntime-web` session from the exact selected
model bytes and binds that session to `{ modelId, modelDigest }`, where `modelDigest` is the SHA-256
digest of those bytes. Capability authenticity plus the model identity and digest bindings are
verified against the host-private session registry before transfer; the capability and session
never enter `raveStore`, project data, or caller-supplied worker messages. A `loaded` store flag,
deterministic helper or shim, worker-like object, missing registry entry, tampered capability
binding, or fabricated capability is not loaded and returns `MODEL_NOT_LOADED` before render,
cache, insertion, pure-helper invocation, or worker/session request. This contract is unimplemented
today.
A capability verified for one registry session does not select a transfer model or authorize a
different host-owned selection; AC-029 owns that separate operation match.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
obtaining a capability only through successful worker/session initialization for selected bytes,
then proving flag-only, deterministic-shim, fake-worker, tampered-binding, and fabricated-capability
inputs return `MODEL_NOT_LOADED` while the verified capability reaches its bound session.

### AC-029 — Capability matches the host-owned selection

Before any worker request, the trusted RAVE host MUST snapshot the transfer operation's selected
`{ modelId, modelDigest }` from host-owned model selection, resolve the supplied capability in the
host-private session registry, and require the resolved session's exact identity/digest tuple to
equal that snapshot. Neither the capability nor caller-supplied data can select, replace, or widen
the operation tuple. A valid capability for model B used while the host selected model A returns
`MODEL_SESSION_MISMATCH` before worker request, render, cache write, or clip insertion.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`, using
valid capabilities for models A and B. Selection A with capability A reaches its session; selection
A with capability B returns `MODEL_SESSION_MISMATCH` with zero worker calls and zero render, cache,
or insertion effects.

### AC-030 — Worker responses are correlated once

Before posting each encode or decode request, the trusted RAVE host MUST register one outstanding
correlation record containing a host-generated `requestId`, a non-authority
`sessionCorrelationId` bound by the host-private registry to the verified AC-028 session, the
AC-029 `{ modelId, modelDigest }`, and the request phase. After AC-031 boundary validation, a worker
response is accepted exactly once only when every field matches that record. A never-issued,
expired, or cancelled `requestId` returns `WORKER_RESPONSE_STALE`; a retained consumed request
returns `WORKER_RESPONSE_DUPLICATE`. A wrong session, phase, model identity, or digest returns
`WORKER_RESPONSE_MISMATCH`. Rejected responses never reach render, cache, or clip insertion, and a
duplicate causes no additional write.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
accepting one matching encode and decode response, then injecting never-issued, expired, cancelled,
replayed, wrong-session, wrong-phase, wrong-model, and wrong-digest responses. Each rejection
returns its exact typed error and leaves render, cache-write, and clip-insertion call counts
unchanged.

### AC-031 — Worker response payloads are bounded data

At the worker-message boundary and before AC-030 correlation or response acceptance, the RAVE host
MUST parse the exact phase-specific response schema with no unknown fields and validate all
latent/audio numeric vectors as non-empty `Float32Array` values with finite elements and host-owned,
non-shared `ArrayBuffer` backing; `SharedArrayBuffer` is rejected. The host checks the sum of
distinct backing `ArrayBuffer.byteLength` values, not only typed-array view lengths, against
`MAX_RAVE_WORKER_RESPONSE_BYTES = 64 * 1024 * 1024` bytes before iterating values.
Decoded audio contains one or two equal-length channels; its declared frame count equals those
channel lengths and does not exceed the host-owned expected frame count, while its declared sample
rate equals the host-owned expected output sample rate. Malformed shapes, wrong types, zero-length
or unequal channels, sample-rate mismatch, `NaN`, or `Infinity` return
`WORKER_RESPONSE_INVALID`; a byte or frame-count overflow returns `WORKER_RESPONSE_TOO_LARGE`.
Rejected payloads never reach render, cache, or clip insertion.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`, covering
malformed and unknown fields, wrong typed-array shapes, shared backing, zero/unequal channels, wrong
sample rate, `NaN`, `Infinity`, a frame-count overflow, and a small view over a backing buffer larger
than 64 MiB. Every case returns the exact typed error with zero render, cache-write, or
clip-insertion calls.

AC-029 through AC-031 are unimplemented today; no current worker/session transfer path can satisfy
their selection, response-correlation, or payload-validation contracts.

### AC-032 — Direct decode helper remains test-only

The current `decodeLatent.ts` MUST remain a direct deterministic test helper until it is relocated,
with its direct behavioral test and observable contract preserved, to
`src/modules/AudioEngine/useCases/rave/__tests__/helpers/decodeLatent.ts` and the exact current path
is removed in the same change. Its current test directly covers empty input, output frame length,
and finite output. Product reachability and a green test alone do not retire the warning; an ADR
branch is valid only under
[dependency-boundary-validation AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement).

Verify with: `pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/decodeLatent.spec.ts`,
exact current/future path searches, and `pnpm deps:validate`

### AC-033 — Direct timbre helper needs behavioral evidence

The current `timbreTransfer.ts` MUST remain a direct deterministic test helper until a direct
behavioral test proves its finite-blend contract: blend is clamped to `[0, 1]`; output follows
source-vector order and `timeSec`; non-empty target vectors cycle by source index; missing target
dimensions contribute `0`; an empty target preserves source values; and neither input is mutated.
Only after that test is green is the same change permitted to relocate the helper and test to
`src/modules/AudioEngine/useCases/rave/__tests__/helpers/timbreTransfer.ts` and remove the exact
current path, or satisfy
[dependency-boundary-validation AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement).
The current `timbreTransfer.spec.ts` only checks that the export exists; it does not call the helper
or prove any preserved behavior. Product reachability and the current green export-only test are
non-retiring.

Verify with: the strengthened
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/timbreTransfer.spec.ts` covering every
named behavior and deep-equality snapshots of both inputs, followed by exact path searches and
`pnpm deps:validate`

## Current-state ownership

The four current `no-orphans` paths are direct deterministic CI/test helpers only. The focused
command is green. The encode/decode tests make the direct calls described in AC-024/AC-032; the
timbre test is export-only; and the interpolation test calls only midpoint/missing-dimension cases,
without the required endpoint `timeSec` or immutability evidence. None proves the model-backed
product contracts in AC-001 through AC-005 or AC-027 through AC-031, and none retires a warning by
passing:

| Current warning path | Current disposition | Required future helper path | Warning closes only when |
| --- | --- | --- | --- |
| `src/modules/AudioEngine/useCases/rave/encodeAudio.ts` | Direct deterministic test helper; current direct test exists. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/encodeAudio.ts` | AC-024's direct test is preserved and green in the same relocation/removal change, or that tested change satisfies dependency AC-008. |
| `src/modules/AudioEngine/useCases/rave/decodeLatent.ts` | Direct deterministic test helper; current direct test exists. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/decodeLatent.ts` | AC-032's direct test is preserved and green in the same relocation/removal change, or that tested change satisfies dependency AC-008. |
| `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts` | Direct deterministic test helper; current test is export-only and insufficient. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/timbreTransfer.ts` | AC-033's missing direct test is green before the exact path is removed in the same relocation change, or the same tested change satisfies dependency AC-008. |
| `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts` | Direct deterministic test helper; current test is partial and insufficient. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/interpolateLatent.ts` | AC-026's missing endpoint/immutability assertions are green before the exact path is removed in the same relocation change, or the same tested change satisfies dependency AC-008. |

Direct helper availability, passing CI tests, and product reachability are not warning retirement
conditions. `AC-005` owns `MODEL_NOT_LOADED` with zero pure-helper calls; `AC-024`, `AC-026`,
`AC-032`, and `AC-033` own the path-specific direct-test and relocation gates; dependency
[AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement) owns the
only ADR retirement condition; `AC-027` owns model-result provenance; and
`AC-028` owns loaded-session authenticity. `AC-029` owns the host-selection/session match; `AC-030`
owns response correlation and replay rejection; and `AC-031` owns response schema and payload
bounds. This spec retains all four current files and does not authorize a silent product fallback.

## Constraints

- **Model-path resolution under Vite** — the `modelPath` strings in `FACTORY_MODELS` are
  relative (e.g. `models/rave/strings.onnx`) and must be resolved against
  `import.meta.env.BASE_URL` by a future RAVE-owned download implementation so model fetches
  work under a non-root deploy base; no RAVE-owned download implementation exists under the
  current `src/modules/AudioEngine/useCases/rave` surface. The existing BrowserAi owner at
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
