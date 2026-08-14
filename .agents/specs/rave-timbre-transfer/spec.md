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
    - ../../decisions/README.md
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
to the host-owned transfer selection under AC-029, MUST render output from only
AC-030/AC-031/AC-034/AC-036-valid worker responses and insert a new clip on the source track through
the existing clip-insertion path, honouring the `placement` mode.

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

| Input condition                                                                                                                                     | Result                      | Required effect boundary                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| No verified AC-028 session capability, including store-flag-only, deterministic-shim, fake-worker, tampered-binding, or fabricated-capability input | `MODEL_NOT_LOADED`          | No pure-helper invocation and no worker/session request                           |
| Verified capability/session does not match the AC-029 host-owned transfer selection                                                                 | `MODEL_SESSION_MISMATCH`    | No worker request, render, cache write, or clip insertion                         |
| Verified matched session; invalid sample-rate input                                                                                                 | `SAMPLE_RATE_MISMATCH`      | No worker request, render, cache write, or clip insertion                         |
| Verified matched session; invalid clip-type input                                                                                                   | `CLIP_NOT_AUDIO`            | No worker request, render, cache write, or clip insertion                         |
| AC-037 source/target frame, request-byte, or aggregate pending-byte limit is exceeded                                                               | `WORKER_REQUEST_TOO_LARGE`  | No resample, request id/record, clone/post, render, cache write, or insertion     |
| AC-035 session already has 32 unexpired pending requests before registration                                                                        | `WORKER_REQUEST_OVERLOADED` | No request id, correlation record, worker post, render, cache write, or insertion |
| AC-035 pending request reaches its 30,000 ms monotonic deadline                                                                                     | `WORKER_REQUEST_TIMEOUT`    | Correlation removed before settlement; no render, cache write, or clip insertion  |
| AC-035 pending request is cancelled or its session is torn down                                                                                     | `WORKER_REQUEST_CANCELLED`  | Correlation removed before settlement; no render, cache write, or clip insertion  |
| Worker response has no outstanding request                                                                                                          | `WORKER_RESPONSE_STALE`     | No response acceptance, render, cache write, or clip insertion                    |
| Worker response reuses a consumed request                                                                                                           | `WORKER_RESPONSE_DUPLICATE` | No additional response acceptance, render, cache write, or clip insertion         |
| Worker response fields do not match the outstanding request's session, phase, model identity, or digest                                             | `WORKER_RESPONSE_MISMATCH`  | No response acceptance, render, cache write, or clip insertion                    |
| Worker response violates an AC-031 envelope, AC-034 result shape, or AC-036 view/finite-number rule                                                 | `WORKER_RESPONSE_INVALID`   | No response acceptance, render, cache write, or clip insertion                    |
| Worker response exceeds an AC-031 UTF-8 string, AC-034 frame-count, or AC-036 backing-buffer limit                                                  | `WORKER_RESPONSE_TOO_LARGE` | No response acceptance, payload logging, render, cache write, or clip insertion   |
| A valid, correlated `terminal-error` worker response reports an operation failure                                                                   | `WORKER_OPERATION_FAILED`   | No render, cache write, or clip insertion                                         |

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
covering every table row. No-model execution invokes neither a pure helper nor a worker/session;
flag-only, deterministic-shim, fake-worker, tampered-binding, and fabricated-capability cases each
return `MODEL_NOT_LOADED`. Pending-capacity, timeout, and cancellation fixtures return the three
named lifecycle outcomes; every AC-037 over-limit fixture returns `WORKER_REQUEST_TOO_LARGE`.
Oversized AC-031 identifiers and terminal diagnostics return `WORKER_RESPONSE_TOO_LARGE`. Every
selection, request, or response rejection occurs before the listed effects.

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
`raveDownloadModel` runs. Factory downloads and custom imports pass AC-038 and AC-039 before
session initialization.

Verify with: `pnpm test:run -- rave`

### AC-010 — WebGPU-to-WASM-SIMD backend fallback with slow-path progress

When WebGPU is unavailable the runtime must fall back to WASM-SIMD and report progress on the
slow path (a 10 s source encodes in roughly 6–8 s on WASM).

Verify with: `pnpm test:run -- rave`

### AC-011 — Worker-crash and download-failure error variants

A crashed worker must surface as `WORKER_CRASHED` and a failed model download as
`MODEL_DOWNLOAD_FAILED`, each as its `RaveError` variant rather than throwing.
`WORKER_CRASHED` covers worker or transport failure and is distinct from a correlated
AC-031 `terminal-error`, which returns `WORKER_OPERATION_FAILED`; the worker response contract
defines no additional terminal error codes.

Verify with: `pnpm test:run -- rave`

### AC-012 — Encode performance budget

A mark-based benchmark must verify the mocked-model encode path handles 30 s of 44.1 kHz audio
in under 200 ms on the declared baseline machine.

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
caching a user-supplied model through AC-038 and AC-039. A store flag alone is never presented as
a loaded session.

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

The current `interpolateLatent.ts` file MUST remain a directly callable deterministic test
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
from AC-030-correlated, AC-031-envelope-valid, AC-034-shape-valid, and AC-036-buffer-valid
`encode-success` and `decode-success` result payloads produced by that capability's named worker and
worker-owned `onnxruntime-web` session. A correlated `terminal-error` is a terminal failure and
supplies no render, cache, or insertion bytes. The owning test observes the verified session receive
both encode and decode, makes its result intentionally different from every pure-helper result, and
proves the rendered, cached, and inserted bytes equal the accepted session result; pure-helper
output cannot satisfy model-backed transfer.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
asserting the verified session's encode/decode calls, accepted response correlation, and
model-distinguishable bytes at render, cache, and insertion boundaries.

### AC-028 — Verified ONNX session capability

A future model-backed transfer MUST accept a model as genuinely loaded only through an opaque,
unforgeable, non-serializable `RaveSessionCapability` issued by the trusted RAVE worker host after
the named worker successfully initializes an `onnxruntime-web` session from the exact selected
model bytes accepted by AC-038 and binds that session to `{ modelId, modelDigest, latentDim }`, where
`modelDigest` is the SHA-256 digest of those bytes and `latentDim` is the host-owned pinned model
descriptor value.
Capability authenticity plus the model identity, digest, and latent-dimension bindings are
verified against the host-private session registry before transfer; the capability and session
never enter `raveStore`, project data, or caller-supplied worker messages. A `loaded` store flag,
deterministic helper or shim, worker-like object, missing registry entry, tampered capability
binding, or fabricated capability is not loaded and returns `MODEL_NOT_LOADED` before render,
cache, insertion, pure-helper invocation, or worker/session request. This contract is unimplemented
today.
A capability verified for one registry session does not select a transfer model or authorize a
different host-owned selection; AC-029 owns that separate operation match.

Before accepting a RAVE worker-host implementation, an ADR listed as accepted in
`.agents/decisions/README.md` selects exactly one trust and availability branch:

- `resource-isolated-runner`: a runner and transport outside the receiving JavaScript realm enforce
  ADR-pinned positive-safe-integer `MAX_PREDELIVERY_RAVE_REQUEST_BYTES`,
  `MAX_PREDELIVERY_RAVE_QUEUED_REQUESTS`, `MAX_PREDELIVERY_RAVE_RESPONSE_BYTES`, and
  `MAX_PREDELIVERY_RAVE_QUEUED_RESPONSES` values. Request limits run before runner-side structured
  clone or request-queue insertion; response limits run before host-side clone or response-queue
  insertion. The request-byte value is no greater than AC-037's
  `MAX_RAVE_WORKER_REQUEST_BYTES`, and the queued-request value is no greater than AC-035's
  `MAX_PENDING_REQUESTS_PER_SESSION`. The ADR names each enforcing component and overload outcome;
  only this branch keeps availability under a compromised Worker in scope.
- `integrity-verified-worker`: the host verifies the exact Worker, bootstrap, `onnxruntime-web`, and
  model-session artifacts before issuing the capability, and the ADR explicitly excludes a
  compromised Worker from the threat model. AC-037 request validation before posting and
  AC-031/AC-034/AC-036 response validation after structured clone still protect integrity,
  fail-closed effects, and work after each boundary, but cannot prevent response-clone allocation or
  host-queue exhaustion and provide no compromised-Worker availability confinement.

No accepted RAVE worker-host ADR or implementation exists today; any availability claim is
contingent on the selected branch.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
obtaining a capability only through successful worker/session initialization for selected bytes,
then proving flag-only, deterministic-shim, fake-worker, tampered-binding, and fabricated-capability
inputs return `MODEL_NOT_LOADED` while the verified capability reaches its bound session. The
selected ADR branch additionally proves either pre-delivery byte/queue enforcement at each pinned
request and response value and one unit above, or exact artifact-integrity rejection before
capability issuance.

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

After AC-035 has registered a pending request and AC-031, AC-034, and AC-036 boundary validation has
finished, the trusted RAVE host MUST accept a worker response only through one atomic
single-consumption transition on the session's host-private request state.
The incoming correlation tuple `[requestId, sessionCorrelationId, modelId, modelDigest, phase]`
equals the pending record's five named fields as one validation result; `type` and every result,
audio, channel, metadata, or error field are validated under AC-031/AC-034/AC-036 and are excluded
from this tuple. When the tuple matches, the host transitions that record from `pending` to
`consumed` and subtracts its AC-037 `requestBytes` charge from the session aggregate before any
result use or render/cache/insertion effect. The transition is serialized so concurrent delivery
cannot accept the same pending record twice; each valid request therefore produces at most one
accepted terminal response and at most one corresponding effect.

Consumed replay state is scoped to one host-private verified RAVE session. The session uses
`MAX_CONSUMED_REQUESTS_PER_SESSION = 256`, `CONSUMED_REQUEST_TTL_MS = 300_000`, a monotonic host
clock, and a strictly increasing per-session `consumptionSequence`. Before every response lookup,
entries with `now - consumedAtMonotonicMs >= CONSUMED_REQUEST_TTL_MS` are removed. After a consumed
entry is inserted, capacity overflow evicts the entry with the lowest
`(consumedAtMonotonicMs, consumptionSequence, requestId)` tuple. A retained consumed request with
the same five-field tuple returns `WORKER_RESPONSE_DUPLICATE`; the same `requestId` with any of the
other four tuple fields changed returns `WORKER_RESPONSE_MISMATCH`. A different never-issued,
cancelled, expired, or evicted `requestId` returns `WORKER_RESPONSE_STALE`, with no correlation
acceptance or effect. This consumed map and its 256-entry/300-second retention are distinct from the
AC-035 pending map and request deadline. Session teardown also clears the consumed map; a response
after teardown is `WORKER_RESPONSE_STALE`.

A valid correlated `terminal-error` is consumed by the same transition, returns
`WORKER_OPERATION_FAILED`, and has no render, cache, or insertion effect. Rejected responses never
reach render, cache, or clip insertion, and a duplicate, expired, or evicted replay causes no
additional write.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`,
accepting one exact matching `encode-success`, one exact matching `decode-success`, and one exact
matching `terminal-error` response, then injecting never-issued, cancelled, wrong-session,
wrong-phase, wrong-model, and wrong-digest responses. It replays a matching consumed request within
the 300-second/256-entry window and expects `WORKER_RESPONSE_DUPLICATE`, accepts 257 requests to
force the named oldest-entry eviction and expects `WORKER_RESPONSE_STALE` for that replay, advances
the monotonic clock by 300,000 ms and expects `WORKER_RESPONSE_STALE` after expiry, and sends a
response after teardown with the same result. AC-031/AC-034/AC-036-invalid responses fail before
correlation; each tuple mismatch leaves render, cache-write, and clip-insertion call counts
unchanged; the matching terminal error returns `WORKER_OPERATION_FAILED` with the same effect
counts; and concurrent duplicate delivery accepts at most one terminal response/effect.

### AC-031 — Worker response payloads are bounded data

At the worker-message boundary and before AC-030 correlation or response acceptance, the RAVE host
MUST validate the following single closed discriminated `RaveWorkerResponse` union.
`MAX_WORKER_PROTOCOL_ID_UTF8_BYTES = 256` and
`MAX_WORKER_DIAGNOSTIC_UTF8_BYTES = 4096` are reusable Worker-message limits measured as
`new TextEncoder().encode(value).byteLength`. `WorkerProtocolId` means a non-empty string within the
identifier limit; `WorkerDiagnostic` means a non-empty string within the diagnostic limit;
`Sha256Hex` means exactly 64 lowercase hexadecimal characters; and `PositiveSafeInteger` means a
finite integer greater than zero that is safe in JavaScript. Every object below has exactly the
shown keys, with no aliases, omitted keys, or unknown keys:

```text
RaveWorkerResponse =
  | {
      type: "encode-success",
      requestId: WorkerProtocolId,
      sessionCorrelationId: WorkerProtocolId,
      modelId: WorkerProtocolId,
      modelDigest: Sha256Hex,
      phase: "encode",
      result: {
        latents: Float32Array,
        frameCount: PositiveSafeInteger,
        latentDim: PositiveSafeInteger
      }
    }
  | {
      type: "decode-success",
      requestId: WorkerProtocolId,
      sessionCorrelationId: WorkerProtocolId,
      modelId: WorkerProtocolId,
      modelDigest: Sha256Hex,
      phase: "decode",
      result: {
        audio: {
          channels: [Float32Array] | [Float32Array, Float32Array],
          sampleRate: PositiveSafeInteger,
          frameCount: PositiveSafeInteger
        }
      }
    }
  | {
      type: "terminal-error",
      requestId: WorkerProtocolId,
      sessionCorrelationId: WorkerProtocolId,
      modelId: WorkerProtocolId,
      modelDigest: Sha256Hex,
      phase: "encode" | "decode",
      error: {
        code: "WORKER_OPERATION_FAILED",
        message: WorkerDiagnostic
      }
    }
```

The five common correlation fields are exactly `requestId`, `sessionCorrelationId`, `modelId`,
`modelDigest`, and `phase`; `type` is the only discriminant and is not an additional correlation
field. An `encode-success` result has only `latents`, `frameCount`, and `latentDim`; a
`decode-success` result has only `audio`; `audio` has only `channels`, `sampleRate`, and
`frameCount`. A `terminal-error` has only `error`, whose `code` has the one literal value shown and
whose `message` is diagnostic text only. The terminal error object has no result payload and this
contract defines no other terminal error codes. Every response string is therefore an exact literal,
`WorkerProtocolId`, `WorkerDiagnostic`, or `Sha256Hex`; no unbounded string is admitted.

The trusted Worker response constructor rejects an over-limit identifier or malformed digest and
does not post that envelope. It truncates a terminal diagnostic to the longest UTF-8 code-point
prefix within `MAX_WORKER_DIAGNOSTIC_UTF8_BYTES` before `postMessage`. The host independently checks
the same string limits after structured clone and before correlation, payload logging, or result use.
Over-limit `requestId`, `sessionCorrelationId`, `modelId`, or `error.message` returns
`WORKER_RESPONSE_TOO_LARGE`; an invalid `modelDigest` returns `WORKER_RESPONSE_INVALID`. Receiver
validation cannot prevent structured-clone allocation or host-queue exhaustion caused by a
compromised Worker and is not availability confinement. It protects envelope integrity and
fail-closed effects and limits subsequent string/result handling to the named AC-031/AC-034/AC-036
predicates. Availability under a compromised Worker exists only under AC-028's
`resource-isolated-runner` branch; the `integrity-verified-worker` branch excludes that threat.

Envelope validation covers every root and nested own key, exact `type`/`phase` pairing, the variant's
exact payload keys, terminal-error shape, all scalar types, and every fixed or variable string before
AC-030 reads a correlation field or any consumer reads or logs a result. Unknown or missing fields,
wrong types, invalid discriminants, invalid `type`/`phase` pairings, malformed terminal errors, and
invalid fixed-format strings return `WORKER_RESPONSE_INVALID`; an over-limit variable string returns
`WORKER_RESPONSE_TOO_LARGE`. AC-034 separately owns host metadata and result-shape validation;
AC-036 owns typed-array backing, aggregate backing bytes, and numeric finiteness. Both run before
correlation or result use. A valid, AC-030-correlated `terminal-error` is instead
`WORKER_OPERATION_FAILED` with no render, cache-write, or clip-insertion effect. Rejected envelopes
never reach those effects.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`, covering
one exact `encode-success` with only `latents`, `frameCount`, and `latentDim`, one exact
`decode-success` with its sample-rate and frame-count metadata, and one exact `terminal-error`, plus
unknown fields at the root and nested result/error objects, missing fields, wrong discriminants,
wrong `type`/`phase` pairs, and malformed terminal errors. It also covers exact-limit and
one-byte-over-limit ASCII and multibyte values for `requestId`, `sessionCorrelationId`, `modelId`,
and `error.message`; a 65-character or non-hex `modelDigest`; Worker-side identifier rejection and
diagnostic truncation; and host-side post-clone rejection from a compromised-Worker fixture. The
test proves wrong-type, empty, or invalid fixed-format strings return `WORKER_RESPONSE_INVALID`,
over-limit variable strings return `WORKER_RESPONSE_TOO_LARGE`, and every rejection occurs with zero
correlation, payload logging, render, cache-write, and clip-insertion calls. The compromised-Worker
fixture proves only post-clone integrity and fail-closed effects. A valid correlated terminal error
still returns `WORKER_OPERATION_FAILED` with the same zero effects.

AC-029 through AC-031 and AC-034 through AC-039 are unimplemented today; no current worker/session
transfer path emits the closed response union or can satisfy their selection, request-lifetime,
request-resource, response-correlation, envelope-validation, result-shape, or result-buffer
contracts.

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

### AC-034 — Worker results match host-owned shapes

After AC-031 envelope validation and before AC-030 correlation or result use, the RAVE host MUST
validate every success payload against the expected shape retained by the receiving transport's
host-private verified session; no response field selects that session or expected shape.

For `encode-success`, `latentDim` equals both the host-private session's `latentDim` and the selected
model descriptor's `latentDim`; disagreement between those host-owned values returns
`MODEL_SESSION_MISMATCH` before a Worker request. The pinned descriptor also supplies `sampleRate`,
`frameSizeSamples`, and `hopSizeSamples`; the host frame planner derives and records the expected
`frameCount` from the resampled input and those values before posting. A current helper-compatible
descriptor uses `frameSizeSamples = hopSizeSamples = floor(sampleRate * 0.02)`. If the descriptor
lacks any of those values, the host returns `MODEL_SESSION_MISMATCH` before posting rather than
adding response timing or hop metadata. The response's `latentDim` and `frameCount` equal those two
host-owned expected values.

For `encode-success`, the host next applies AC-036's `MAX_RAVE_WORKER_RESPONSE_BYTES` and rejects
`WORKER_RESPONSE_TOO_LARGE` when
`latentDim > floor(MAX_RAVE_WORKER_RESPONSE_BYTES / 4)` or
`frameCount > floor(MAX_RAVE_WORKER_RESPONSE_BYTES / (4 * latentDim))`. Only after those divisions
does it compute `elementCount = frameCount * latentDim` and
`expectedByteLength = elementCount * 4`; neither multiplication occurs earlier. A valid encode result has
`latents.length === elementCount` and `latents.byteLength === expectedByteLength`. For
`decode-success`, the host-private decode render plan records expected `sampleRate` and maximum
`frameCount` before posting; a valid decode result has that sample rate, has
`audio.frameCount === channel.length` for every channel, and does not exceed that maximum. Metadata,
view-length, sample-rate, or unequal-channel failures return `WORKER_RESPONSE_INVALID`; an encode
multiplication guard or decoded frame count above its host-owned maximum returns
`WORKER_RESPONSE_TOO_LARGE`. Each rejection precedes AC-030 correlation, payload logging, render,
cache write, and clip insertion.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`, covering
encode latent-dimension/frame-count/length matches and mismatches, absent descriptor metadata,
checked multiplication overflow, one and two decoded channels, unequal channel lengths, expected
and wrong sample rates, and exact and excessive decoded frame counts. It proves host-owned expected
values are selected from the receiving session rather than response fields; invalid shapes return
the specified `WORKER_RESPONSE_INVALID` or `WORKER_RESPONSE_TOO_LARGE` before correlation, payload
logging, or any render/cache/insertion effect.

### AC-035 — Pending Worker requests have fixed admission and lifetime

Each verified session MUST own a host-private pending-request map with
`MAX_PENDING_REQUESTS_PER_SESSION = 32` and `PENDING_REQUEST_TIMEOUT_MS = 30_000`. Before assigning a
`requestId` or posting each encode/decode request, the host runs the timeout sweep below and AC-037's
frame/per-request planning, then enters one session-serialized admission transition. That transition
first applies AC-037's aggregate-byte guard, then counts the remaining records. Either AC-037 failure
returns `WORKER_REQUEST_TOO_LARGE`; if 32 records remain after those checks pass, the host returns
`WORKER_REQUEST_OVERLOADED`. Either rejection precedes request-id generation, map mutation, resample,
and Worker `postMessage`. Otherwise, within that transition the host generates an id absent from both
maps, registers `{ requestId, sessionCorrelationId, modelId, modelDigest, phase, requestBytes,
registeredAtMonotonicMs, deadlineMonotonicMs }`, and adds `requestBytes` to the host-private session
counter `pendingRequestBytes`. The non-authority `sessionCorrelationId` is bound by the host-private
registry to the verified AC-028 session; model identity/digest come from AC-029;
`deadlineMonotonicMs = registeredAtMonotonicMs + PENDING_REQUEST_TIMEOUT_MS`. The Worker post occurs
only after registration and is serialized with timeout, cancellation, and teardown: it proceeds only
if that exact record remains pending. If cleanup wins during resampling, the host discards the
resample buffers and posts no message.

The host runs the timeout sweep before capacity checks, before AC-030 response lookup, and when a
deadline timer fires. A record expires when `nowMonotonicMs >= deadlineMonotonicMs`; the host
atomically removes it and subtracts its `requestBytes` charge before settling
`WORKER_REQUEST_TIMEOUT`, and any later response for that id is `WORKER_RESPONSE_STALE`. Explicit
cancellation performs the same removal/charge subtraction before settling
`WORKER_REQUEST_CANCELLED`. Session teardown subtracts every pending charge, removes and settles
every pending operation as `WORKER_REQUEST_CANCELLED`, clears the map, sets `pendingRequestBytes` to
zero, and posts no new message. Timeout, cancellation, and teardown restore count/byte capacity immediately and cause no
render, cache-write, or clip-insertion effect. AC-030's consumed replay map has its own
256-entry/300-second policy and does not count toward either pending cap.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`, leaving
32 requests unexpired, expecting the 33rd to return `WORKER_REQUEST_OVERLOADED`, and proving that
rejection adds no request id, map entry, or Worker post. Advance the monotonic clock to exactly
30,000 ms and prove timeout removal/settlement before lookup, a stale late response, and restored
capacity. Explicit cancellation has the same removal, stale-response, and restored-capacity
observations, including exact AC-037 byte-charge release. Teardown settles and clears all remaining
pending records and byte charges, leaves no correlation, posts no message, and makes every later
response stale while AC-030 consumed-replay tests remain independent. A cleanup-during-resample
fixture proves cleanup wins the serialized post transition, releases the charge and buffers, and
posts no message.

### AC-036 — Worker result buffers have fixed storage limits

After AC-031 envelope validation and before AC-034 shape validation, AC-030 correlation, payload
logging, or element iteration, the RAVE host MUST validate each success-result view with
`Object.getPrototypeOf(view) === Float32Array.prototype`, `view.length > 0`, and
`Object.getPrototypeOf(view.buffer) === ArrayBuffer.prototype`; `SharedArrayBuffer` and every other
backing type are invalid. It sums `byteLength` for each distinct backing `ArrayBuffer` in the
envelope, counting one buffer once even when multiple views share it. A total above
`MAX_RAVE_WORKER_RESPONSE_BYTES = 64 * 1024 * 1024` returns `WORKER_RESPONSE_TOO_LARGE` before any
element is read. At or below that total, every element passes `Number.isFinite(value)`; an invalid
view/backing, empty view, `NaN`, or infinity returns `WORKER_RESPONSE_INVALID`. Neither outcome
reaches AC-030 correlation, payload logging, render, cache write, or clip insertion.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`, covering
ordinary `Float32Array` views, a subclass/prototype mismatch, empty views, shared ordinary backing,
`SharedArrayBuffer`, exact 64 MiB and one-byte-over backing totals, a small view over a backing buffer
larger than 64 MiB, `NaN`, `Infinity`, and `-Infinity`. It proves distinct backing buffers are each
counted once, the byte cap is checked before element iteration, and every rejection returns the
specified typed outcome with zero correlation, payload logging, render, cache-write, and insertion
calls.

### AC-037 — Worker requests have fixed PCM and byte budgets

After AC-005 input validation and the AC-035 timeout sweep, but before source/target resampling,
request-id generation, AC-035 registration, structured clone, or Worker `postMessage`, the RAVE host
MUST apply these request limits:

```text
MAX_RAVE_PCM_FRAMES_PER_INPUT = 1_440_000
MAX_RAVE_WORKER_REQUEST_BYTES = 32 * 1024 * 1024
MAX_PENDING_RAVE_REQUEST_BYTES_PER_SESSION = 64 * 1024 * 1024
```

Source and target PCM each contain one or two equal-length channels satisfying AC-036's ordinary
`Float32Array` view, ordinary `ArrayBuffer` backing, nonempty-view, distinct-backing, and finite-value
predicates; AC-037 supplies the request-side limits and outcomes. `inputFrameCount` is that channel
length. The frame limit applies independently to each original input and its planned model-rate
result. Before allocating a resample, the host rejects multiplication overflow when
`inputFrameCount > floor(Number.MAX_SAFE_INTEGER / modelSampleRate)`, then computes
`plannedFrameCount = ceil(inputFrameCount * modelSampleRate / inputSampleRate)` from the validated
positive input rate and pinned descriptor rate. For every input whose rate differs from the model
rate, the host computes its contribution to `plannedPcmBytes` with checked
`plannedFrameCount * channelCount * 4` operations; same-rate and non-PCM inputs contribute zero. The
resampler creates tight host-owned `Float32Array` buffers totaling exactly `plannedPcmBytes`.

For every encode or decode request, the host initializes `requestBytes = 0`, visits each distinct
request typed-array backing once, and before adding its `byteLength` requires
`byteLength <= MAX_RAVE_WORKER_REQUEST_BYTES - requestBytes`. `inputBackingBytes` is the resulting
subtotal. It then visits each planned resample contribution and, before adding it, requires
`contribution <= MAX_RAVE_WORKER_REQUEST_BYTES - requestBytes`. The final conservative charge is
`requestBytes = inputBackingBytes + plannedPcmBytes`; it charges both inspected input storage and
every additional resample allocation, and every subtraction precedes its addition. As the first
check in AC-035's session-serialized admission transition, the host accepts aggregate admission only when
`requestBytes <= MAX_PENDING_RAVE_REQUEST_BYTES_PER_SESSION - pendingRequestBytes`; the subtraction
precedes addition. A source/target original or planned frame overflow, checked-arithmetic failure,
per-request overflow, or aggregate pending overflow returns `WORKER_REQUEST_TOO_LARGE`. Because
AC-037 runs before AC-035's count check, this byte outcome wins when both byte and count limits fail.
Rejection creates no request id, correlation/byte charge, resample buffer, clone/post, render, cache
write, or clip insertion. AC-035 registration adds the charge atomically; AC-030 terminal consumption
and AC-035 timeout/cancellation/teardown remove it atomically.

Verify with: the future owning test, run as
`pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/transferTimbreToClip.spec.ts`, covering
source and target frame counts 1, 1,440,000, and 1,440,001; exact and one-over planned resample
frames; checked multiplication failure; shared and distinct request backings; a small view over a
large backing; per-request charges exactly 32 MiB and one byte over; and aggregate pending charges
exactly 64 MiB and one byte over. A fixture exceeding both aggregate bytes and 32 pending records
returns `WORKER_REQUEST_TOO_LARGE`. Every over-limit fixture returns that code before the named
operations with zero effects, while terminal, timeout, cancellation, and teardown fixtures prove
the exact charge is released.

### AC-038 — Model ingress bytes are bounded

Every factory download and custom `.onnx` import MUST enter through one host-owned bounded stream
before a full model buffer, cache entry, worker message, or ONNX session is created, with
`MAX_RAVE_MODEL_BYTES = 256 * 1024 * 1024`. A known `Content-Length` or `File.size` above the limit is
rejected before reading. An unknown or smaller declared size does not bypass enforcement: before
accepting each nonempty chunk, the host requires
`chunk.byteLength <= MAX_RAVE_MODEL_BYTES - receivedBytes`, then adds it. Empty input returns
`MODEL_ARTIFACT_INVALID`; declared or actual overflow returns `MODEL_ARTIFACT_TOO_LARGE`. An
unbounded `arrayBuffer()` read before this check is forbidden. Only a nonempty accepted stream
produces the exact SHA-256 `modelDigest` and a tight host-owned model buffer.

Verify with: future model-ingress tests covering known, unknown, and false declared sizes; empty,
exactly 256 MiB, and one-byte-over streams; custom `File` preflight plus actual-stream overflow; and
zero downstream effects for each named rejection.

### AC-039 — Model cache bytes are bounded

The model cache MUST serialize admission, cap `MAX_CACHED_RAVE_MODEL_BYTES` at
`512 * 1024 * 1024`, evict least-recently-used entries that have no live AC-028 session, and require
`modelBytes <= MAX_CACHED_RAVE_MODEL_BYTES - cachedModelBytes` before insertion. Failure returns
`MODEL_CACHE_FULL` and creates no cache record, worker post, session, capability, or store `loaded`
flag. These byte limits do not claim to confine ONNX execution memory; AC-028's accepted ADR selects
that runtime boundary before custom models can initialize a session.

Verify with: future cache tests covering admission exactly 512 MiB and one byte over, LRU eviction
that excludes live sessions, serialized concurrent admission, and zero downstream effects on
`MODEL_CACHE_FULL`.

## Current-state ownership

The four current `no-orphans` paths are direct deterministic test helpers only. The focused
command is green. The encode/decode tests make the direct calls described in AC-024/AC-032; the
timbre test is export-only; and the interpolation test calls only midpoint/missing-dimension cases,
without the required endpoint `timeSec` or immutability evidence. None proves the model-backed
product contracts in AC-001 through AC-005, AC-027 through AC-031, or AC-034 through AC-039, and
none retires a warning by passing:

| Current warning path                                         | Current disposition                                                             | Required future helper path                                                    | Warning closes only when                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/AudioEngine/useCases/rave/encodeAudio.ts`       | Direct deterministic test helper; current direct test exists.                   | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/encodeAudio.ts`       | AC-024's direct test is preserved and green in the same relocation/removal change, or that tested change satisfies dependency AC-008.                                              |
| `src/modules/AudioEngine/useCases/rave/decodeLatent.ts`      | Direct deterministic test helper; current direct test exists.                   | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/decodeLatent.ts`      | AC-032's direct test is preserved and green in the same relocation/removal change, or that tested change satisfies dependency AC-008.                                              |
| `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts`    | Direct deterministic test helper; current test is export-only and insufficient. | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/timbreTransfer.ts`    | AC-033's missing direct test is green before the exact path is removed in the same relocation change, or the same tested change satisfies dependency AC-008.                       |
| `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts` | Direct deterministic test helper; current test is partial and insufficient.     | `src/modules/AudioEngine/useCases/rave/__tests__/helpers/interpolateLatent.ts` | AC-026's missing endpoint/immutability assertions are green before the exact path is removed in the same relocation change, or the same tested change satisfies dependency AC-008. |

Direct helper availability, passing helper tests, and product reachability are not warning retirement
conditions. `AC-005` owns `MODEL_NOT_LOADED` with zero pure-helper calls; `AC-024`, `AC-026`,
`AC-032`, and `AC-033` own the path-specific direct-test and relocation gates; dependency
[AC-008](../dependency-boundary-validation/spec.md#ac-008--accepted-exact-path-retirement) owns the
only ADR retirement condition; `AC-027` owns model-result provenance; and
`AC-028` owns loaded-session authenticity. `AC-029` owns the host-selection/session match; `AC-030`
owns response correlation and replay rejection; `AC-031` owns the closed response envelope and
string limits; `AC-034` owns host-derived result shapes; `AC-035` owns pending-request admission and
lifetime; `AC-036` owns result-view backing, bytes, and numeric finiteness; `AC-037` owns request
PCM and byte budgets; `AC-038` owns model-ingress byte limits; and `AC-039` owns model-cache byte
limits. This spec retains all four current files and does not authorize a silent product fallback.

## Constraints

- **Model-path resolution under Vite** — the `modelPath` strings in `FACTORY_MODELS` are
  relative (e.g. `models/rave/strings.onnx`) and must be resolved against
  `import.meta.env.BASE_URL` by a future RAVE-owned download implementation so model fetches
  work under a non-root deploy base; no RAVE-owned download implementation exists under the
  current `src/modules/AudioEngine/useCases/rave` surface. The existing BrowserAi owner at
  `src/modules/BrowserAi/useCases/downloadModel.ts` is unrelated and does not implement
  RAVE model-path resolution, so this is an unimplemented requirement, not a completed fix.
- **Buffer memory management** — decoded audio buffers (≈5.3 MB per 30 s stereo at 44.1 kHz) must
  use the existing `audioBufferCache` LRU. Model artifacts use AC-039's separate bounded cache and
  must not be retained as unaccounted process memory.

## Open questions

- [ ] Q-001 — Model hosting: bundle the default model and download-on-demand the rest, or
      require self-serve hosting for all five?
- [ ] Q-002 — Real-time block size vs latency trade-off (8192 frames ≈ 185 ms) — is the
      monitor-only positioning acceptable, or is a smaller block worth pursuing?

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
