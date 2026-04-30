# BrowserAi module audit

## Scope

This audit covers `src/modules/BrowserAi/` in full — every file under
`events/`, `models/`, `repositories/`, `services/`, `stores/`,
`useCases/`, `workers/`, and `presentations/views/`. It explicitly
excludes upstream callers (`AiRuntime`, `AiGeneration`, `Workspace`,
`Arrangement`, `MIDI`) except where they touch this module's contract,
and the legacy `audioAi/*` repositories that live in `AudioAnalysis`
(audited separately).

It is an adversarial review: WebGPU/WASM session lifetime, OPFS
correctness, off-main-thread back-pressure, race conditions in lazy
singletons, PII leakage through network fetches, and AGENTS.md
conformance (architecture boundaries, type soundness, function
signatures, no automated tests, no module barrel).

Related spec: none on disk.

---

## Goal

A correctness-first browser-AI surface for the DAW:

- Worker-bound inference is the only path that touches model weights.
  The main thread orchestrates and never blocks on WASM/WebGPU work for
  more than the time required to post a message.
- Sessions (~80 MB Kokoro, ~52 MB vocoder, ~115–160 MB DiffSinger
  voicebanks) are deterministically loaded once and released either by
  LRU eviction or by an explicit user action. Two concurrent renders do
  not double-allocate.
- Render pipelines surface real progress to the UI and are cancellable
  without leaving zombie pending requests, half-evicted sessions, or
  stale store state.
- OPFS storage is the single source of truth for model files; paths
  are coherent across the download manager, storage manager, and the
  use cases that read them; eviction enforces the 2 GB cap (today it
  only logs).
- User-supplied text (lyrics for SVS, TTS prompts) is processed
  entirely in-browser. Outbound network requests carry only public
  voice/model identifiers.
- AGENTS.md hard rules: cross-module imports go through the **module
  root `index.ts`** (today missing); no `as unknown as`/`as any` to
  silence the compiler; one function per `useCases/`/`repositories/`
  file; functions with > 1 parameter take a single object input named
  `<FunctionName>Input` / `<FunctionName>Output`; tests assert real
  contracts.
- WebGPU device acquisition is gated, observable, and survives a tab
  losing its adapter. The capability detector returns honest results.

---

## Relevant code paths

- `src/modules/BrowserAi/` (no root `index.ts` — see issue #1)
- `src/modules/BrowserAi/events/ModelDownloadProgressEvent.ts`
- `src/modules/BrowserAi/events/index.ts`
- `src/modules/BrowserAi/models/BrowserModel.ts`
- `src/modules/BrowserAi/models/CapabilityReport.ts`
- `src/modules/BrowserAi/models/InferenceRequest.ts`
- `src/modules/BrowserAi/models/RenderProgress.ts`
- `src/modules/BrowserAi/models/StorageStatus.ts`
- `src/modules/BrowserAi/models/ddspInstrumentCatalog.ts`
- `src/modules/BrowserAi/models/phonemeMap.ts`
- `src/modules/BrowserAi/repositories/capabilityDetector.ts`
- `src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts`
- `src/modules/BrowserAi/repositories/modelDownloadManager.ts`
- `src/modules/BrowserAi/repositories/storageManager.ts`
- `src/modules/BrowserAi/services/audioResampler.ts`
- `src/modules/BrowserAi/services/kokoroTokenizer.ts`
- `src/modules/BrowserAi/services/midiToDdspInput.ts`
- `src/modules/BrowserAi/services/phonemizer.ts`
- `src/modules/BrowserAi/stores/capabilityStore.ts`
- `src/modules/BrowserAi/stores/index.ts`
- `src/modules/BrowserAi/stores/inferenceProgressStore.ts`
- `src/modules/BrowserAi/stores/modelRegistryStore.ts`
- `src/modules/BrowserAi/stores/renderQueueStore.ts`
- `src/modules/BrowserAi/useCases/cancelRender.ts`
- `src/modules/BrowserAi/useCases/detectCapabilities.ts`
- `src/modules/BrowserAi/useCases/downloadModel.ts`
- `src/modules/BrowserAi/useCases/index.ts`
- `src/modules/BrowserAi/useCases/initBrowserAi.ts`
- `src/modules/BrowserAi/useCases/removeModel.ts`
- `src/modules/BrowserAi/useCases/renderDiffSingerPhrase.ts`
- `src/modules/BrowserAi/useCases/renderKokoroTts.ts`
- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts`
- `src/modules/BrowserAi/workers/tfjsInferenceWorker.ts`
- `src/modules/BrowserAi/presentations/views/AiRenderClipPreview.tsx`
- `src/modules/BrowserAi/presentations/views/CapabilityReportPanel.tsx`
- `src/modules/BrowserAi/presentations/views/KokoroVoiceSelector.tsx`
- `src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx`
- `src/modules/BrowserAi/presentations/views/index.ts`

---

## Current behavior

**Initialisation.** `initBrowserAi.ts:62` is the only entry point
called from `app/bootstrap.ts:34`. It runs capability detection,
requests persistent storage, populates the model registry from the
static catalogs (`ddspInstrumentCatalog.ts`), checks OPFS for cached
Kokoro/vocoder files, and subscribes to `midiStore` to mark
already-rendered phrases stale on note edits.

**Capability detection.** `capabilityDetector.ts:93` checks for a
non-Edge/Opera Chromium UA, the presence of `navigator.gpu`, and runs
a "micro-benchmark" that times `requestAdapter()` (the spec name
`runWebGpuBenchmark` overstates what it does — see issues #15, #16).
The result is cached in `localStorage` under `sourdaw-browser-ai-capability`.

**Model download.** `modelDownloadManager.ts:44` streams the model via
`fetch + ReadableStream`, accumulates `Uint8Array` chunks in memory,
verifies SHA-256 if provided, optionally `unzip`s `.oudep`/`.zip`
payloads via `fflate`, and writes the bytes to OPFS via
`storageManager.writeModel`. Progress is forwarded via a per-download
`BroadcastChannel` _and_ an `onProgress` callback _and_ the
`modelRegistryStore`. Three retries with exponential backoff.

**Storage.** `storageManager.ts:65–233` exposes
`checkModelCached`/`readModel`/`writeModel`/`deleteModel`,
`readRenderCache`/`writeRenderCache`, and `getStorageStatus`. All
operations run on the **main thread** with `createWritable()`. OPFS
paths are flat: `models/<family>/<modelId>` and
`renders/<cacheKey>.pcm`.

**Inference bridge.** `inferenceWorkerBridge.ts:33–267` owns a
module-level `workerState` with two workers: `onnx` (always-on) and
`tfjs` (lazy + 60 s idle teardown). Routes
`runDiffSingerPhrase`/`runKokoroTts` to the ONNX worker and
`runDdspInference` to TF.js. Cancellation is "terminate the worker,
reject all pending requests" via `terminateOnnxWorker` /
`terminateTfjsWorker`.

**Workers.** `onnxInferenceWorker.ts:51` keeps a `Map<modelId,
SessionEntry>` with manual byte accounting; `evictLru` releases
sessions until `totalMemoryBytes <= 1 GB`.
`tfjsInferenceWorker.ts:19` is a **stub** — DDSP browser rendering is
disabled because TF.js cannot be Rolldown-bundled, and every request
returns an error.

**Render use cases.**
- `renderKokoroTts.ts` tokenises text, fetches a per-voice embedding
  from HuggingFace CDN (cached in a module-level `Map`), runs the ONNX
  session in the worker, resamples 24 → 44.1 kHz via
  `OfflineAudioContext`, optionally time-stretches by re-resampling
  again, then writes `.pcm` to OPFS.
- `renderDiffSingerPhrase.ts` phonemises lyrics, builds five
  per-voicebank ONNX sessions plus a shared vocoder session, runs the
  six-stage pipeline in the worker, normalises peak, applies fades,
  and caches.

**Cancellation.** `cancelRender.ts:21` reads the active queue entry,
calls `terminateOnnxWorker`/`terminateTfjsWorker` (which kills _all_
in-flight renders on that worker, not just this phrase), removes the
entry from the queue, and clears the active-render store.

**Stores.** Four stores: `capabilityStore` (idle/detecting/done/error
phases), `inferenceProgressStore` (per-requestId
stage+progress), `modelRegistryStore` (download status across DDSP /
Kokoro / DiffSinger / vocoder), `renderQueueStore` (per-phrase queue
entries plus `phraseStatusMap`). `stores/index.ts` is a barrel.

**Presentation.** Four views — `ModelManagerPanel`,
`CapabilityReportPanel`, `KokoroVoiceSelector`, `AiRenderClipPreview`.
Re-exported from `presentations/views/index.ts`.

**Tests.** **Zero** spec files anywhere in the module. No
`__tests__/`. Nothing in this module is exercised by the test suite.

---

## Findings

1. **No module root `index.ts` — every cross-module consumer reaches
   into sub-paths.** The four external import sites
   (`bootstrap.ts:34`, `StatusBar.tsx:14`, `ClipMidiAiSection.tsx:15-23`,
   `AiSection.tsx:10`) all import from `#/modules/BrowserAi/useCases`,
   `#/modules/BrowserAi/stores`, or
   `#/modules/BrowserAi/presentations/views`. AGENTS.md
   "**Contract Boundaries:** Cross-module imports MUST only target the
   destination module's root `index.ts`" requires a single root barrel.
   There is none. The whole module is consumed via deep paths.

2. **DDSP is shipped to users as a working feature, but the worker is
   a deliberate stub.** `tfjsInferenceWorker.ts:16` always returns
   "DDSP browser rendering is not available". `initBrowserAi.ts:91`
   nonetheless populates four DDSP instruments with `status: 'ready'`
   and `downloadProgress: 1`. `ModelManagerPanel.tsx:266-290` shows
   them as "✓ Cached". A user clicking "render" via DDSP will get an
   error from the worker — the UI promises a feature that does not
   exist. This is product-level dishonesty, not a code bug.

3. **`runWebGpuBenchmark` does not benchmark anything.**
   `capabilityDetector.ts:57-76` times `requestAdapter()`, which is
   adapter discovery, not GPU compute. A device that returns its
   adapter in 5 ms but cannot run an ONNX session at all will be
   classified `webgpu-fast`. The thresholds (50 ms / 500 ms) are
   meaningless against this metric. The cached result then poisons
   subsequent loads via `localStorage`.

4. **`localStorage` capability cache has no schema versioning.**
   `capabilityDetector.ts:99-110` reads the cached `CapabilityReport`
   and uses it as-is. If the `CapabilityReport` shape changes, every
   user keeps a stale cache forever (until they manually clear
   localStorage or hit the "Refresh" button which most users will
   never see). No `version` field, no `detectedAt`-based expiry.

5. **`detectCapabilities` cache fall-through silently swallows
   `JSON.parse` errors.** `capabilityDetector.ts:101-108`: if the
   cache is corrupt the `try { JSON.parse }` block has an empty
   `catch` and falls through to live detection — but the corrupt
   value stays in `localStorage`. Next page load: same parse, same
   silent swallow. Cheap fix: `localStorage.removeItem(STORAGE_KEY)`
   in the catch.

6. **Capability cache check is racing-unsafe with `forceRefresh`.**
   `capabilityDetector.ts:99` reads `cached` only when `!forceRefresh`,
   but the live detection path at `:141` writes the new report _every
   time_, including under `forceRefresh`. There is no path to
   `setItem(STORAGE_KEY, ...)` only on success — if the live detection
   fails (`runWebGpuBenchmark` throws inside the `if` block), the
   `report` object still gets stored with a half-populated state.

7. **`isTauriNonWindowsPlatform` reads `navigator.platform`, which
   is deprecated and lies in modern Chromium.**
   `capabilityDetector.ts:49`. The User-Agent Client Hints API
   (`navigator.userAgentData.platform`) is the correct path; falling
   back to `navigator.platform` will misclassify Apple Silicon under
   Rosetta and miss future platform additions.

8. **`inferenceWorkerBridge.terminateOnnxWorker` is a sledgehammer.**
   `inferenceWorkerBridge.ts:231-241` rejects _every_ pending ONNX
   request, not just the cancelled one, then terminates the worker.
   If a user starts two DiffSinger renders A and B, then cancels A,
   B is also killed — and the user sees B as "error" in
   `renderQueueStore`. There is no per-request cancellation primitive
   in the protocol; the worker has no way to know which inference
   to abort. AbortController exists in `ActiveRender.abortController`
   (`models/RenderProgress.ts:63`) but is never plumbed.

9. **`ActiveRender.abortController` is dead.**
   `models/RenderProgress.ts:63` declares it; the `Omit<ActiveRender,
'abortController'>` everywhere
   (`stores/inferenceProgressStore.ts:14,21`,
   `useCases/renderKokoroTts.ts:124-132`,
   `useCases/renderDiffSingerPhrase.ts:138-146`) means **no one ever
   instantiates an `AbortController`**. The type advertises a feature
   that doesn't exist. Either remove the field or wire it up.

10. **Module-level singletons are not racing-safe (lazy init pattern).**
    `inferenceWorkerBridge.ts:76-86` `getOnnxWorker`: two concurrent
    `loadOnnxSession` callers both observe `workerState.onnx.worker
=== null`, both call `new Worker(...)`, the second clobbers the
    first reference; the first worker leaks (event handlers detached,
    but the Worker stays alive until GC; SharedArrayBuffer-backed
    threads inside it stay alive too). Same race in
    `getTfjsWorker:89-105`. AudioAnalysis audit issue #8 documents
    the same pattern; this module copy-pastes the antipattern.

11. **`onnxInferenceWorker.evictLru` is `await`-serialised and not
    re-entrant.** `onnxInferenceWorker.ts:83-99` walks the cache in
    an `O(n²)` `for` to find the LRU, then `await session.release()`
    while still holding `totalMemoryBytes`. Two concurrent
    `getOrCreateSession` calls that both push the budget over 1 GB
    will both call `evictLru`; both will see the same LRU candidate;
    one will win the `release()` and the other will await a session
    that no longer exists, leaving `totalMemoryBytes` pointing at
    bytes that aren't there. Module-level mutable state without a
    mutex.

12. **`evictLru` walks the cache with `O(n²)` selection sort.**
    `onnxInferenceWorker.ts:83-98`. With six DiffSinger sessions plus
    Kokoro plus a shared vocoder, this is small (8 entries), but the
    `for` loop allocates closure on every entry and re-iterates the
    whole map per eviction. Use a min-heap keyed on `lastUsedAt` if
    this matters, or at minimum sort once.

13. **`evictLru` releases without removing in a critical section.**
    `onnxInferenceWorker.ts:94-97` releases the session **before**
    it deletes the cache entry. Between the `release()` await and
    the `delete()`, another `getOrCreateSession` for the same
    `modelId` would find the entry, call `cached.lastUsedAt = Date.now()`
    on a released session, and return a session whose underlying
    `OrtInferenceSession.run` is undefined behaviour. Delete first,
    release second.

14. **`onnxInferenceWorker` `sizeBytes` is `modelData.byteLength`,
    not actual GPU/heap occupancy.**
    `onnxInferenceWorker.ts:115`: the model's _file size_ is stored,
    not the live tensor allocation. WebGPU adds activation memory,
    intermediate tensors, and shader programs. Real footprint can be
    2–4× the file size. The 1 GB budget therefore overcommits. Add a
    safety margin (e.g. budget = 384 MB instead of 1 GB) or measure
    with `performance.measureUserAgentSpecificMemory()` where
    available.

15. **Worker tensor outputs are never disposed.**
    `onnxInferenceWorker.ts:184-318`: every `await session.run(...)`
    in `runDiffSingerPipeline` returns an `OrtTensor` map. None of
    them call `tensor.dispose()` on intermediate outputs (the
    upstream API exposes `Tensor.dispose()` for WebGPU-backed
    tensors). For long-running sessions this leaks GPU memory across
    inferences — a six-stage pipeline run produces 12–15 intermediate
    tensors, all retained until next GC pass. Worse: `encoderOut`,
    `xMasks`, `phDur`, `pitchPred`, `energyPred`, `breathinessPred`,
    `mel`, `waveform` are reused across stages but never explicitly
    freed.

16. **`onnxInferenceWorker.runKokoroOnnx` swallows transferred-buffer
    semantics.** `onnxInferenceWorker.ts:481` `self.postMessage(response,
[audio.buffer])` transfers the audio. The protocol comment in
    `inferenceWorkerBridge.ts:184-188` confirms transfer semantics
    on the way in (`inputIds.buffer`, `style.buffer`). After
    transfer, the worker side cannot read those buffers — but
    `runKokoroOnnx` is invoked _after_ transfer
    (`onnxInferenceWorker.ts:473`). Fortunately for the protocol,
    the typed-array view's `.data` is owned by ONNX after `new
ort.Tensor(...)`. But the contract is implicit: a future change to
    do extra processing on `inputIds`/`style` after creating the
    tensor would silently get a detached buffer.

17. **`getOrt()` race in worker.**
    `onnxInferenceWorker.ts:55-72`: same Promise-coalesce miss as
    issue #10. Two concurrent `create-session` messages both observe
    `ortModule === null`, both `await import('onnxruntime-web')`,
    both write to the global `ortModule`. The dynamic import is
    cached at the module-system level so the second `await` is fast,
    but `ort.env.wasm.numThreads` is set _twice_, and once the
    second write lands, both calls' downstream session-creation
    inherits whichever `numThreads` won. Wrap in
    `if (!ortModulePromise) ortModulePromise = import(...)`.

18. **`onnxInferenceWorker.tensorDataToOrt` uses a nested IIFE for a
    string select.** `onnxInferenceWorker.ts:128-142` is a
    pyramid-of-doom four-level `if/else` returning a string. Rewrite
    as a switch or a lookup table. Pure cleanup.

19. **`InferenceRequest.WorkerResponse.outputs` is typed as
    `Record<string, TensorData>` but the worker returns wrapped
    `Float32Array`s with no provenance.**
    `onnxInferenceWorker.ts:418-429` writes
    `resultOutputs[key] = { data: val.data as Float32Array, ... }`
    and casts `val.data` to `Float32Array` via `as`. If a model
    produces an `Int32Array` output, the data flows through as
    `Float32Array` typed but `Int32Array` valued; downstream typed
    operations will silently misinterpret bytes. AGENTS.md
    "TypeScript — soundness" forbids `as` to silence the compiler.

20. **`inferenceWorkerBridge.runKokoroTts` / `runDiffSingerPhrase` /
    `runDdspInference` all `as Extract<...>` cast the response.**
    `inferenceWorkerBridge.ts:189,197,204` `response as Extract<...,
{ type: 'tts-result' }>`. If the worker returns an unexpected
    response (e.g. an `error` slips past `sendRequest`), the cast
    masks it and the caller dereferences `audio` on a value that
    doesn't have it. Replace with a runtime narrow:
    `if (response.type !== 'tts-result') throw …`.

21. **`sendRequest` resolves immediately for fire-and-forget but
    returns a fake `status` payload.** `inferenceWorkerBridge.ts:138-140`
    resolves with `{ type: 'status', loadedModels: [], memoryUsageBytes:
0 }` for messages without `requestId`. `releaseOnnxSession` at
    `:213` then awaits a `Promise<void>` that resolves to a fake
    status. A future caller who tries to use the resolution value
    will silently get a lie. Either `void`-resolve or have separate
    typed paths for void messages.

22. **`tfjsIdleTimer` cancellation is racy with concurrent renders.**
    `inferenceWorkerBridge.ts:107-119,203,223`. `scheduleTfjsDestroy`
    sets a 60 s timer; `getTfjsWorker` clears it. If two renders A
    (running, will finish at 70 s) and B (issued at 50 s) are in
    flight, B's `getTfjsWorker` clears the timer scheduled by A's
    `scheduleTfjsDestroy`, but A is still running. A finishes,
    schedules destroy. 60 s later, B has long since finished — the
    timer fires and tears down a worker that has been idle, fine.
    But if B starts at 59 s (after A's `scheduleTfjsDestroy` at
    end-of-A-but-before-end-of-A-await), A's timer is already
    pending; B's `getTfjsWorker` clears it; B does its work; B's
    `scheduleTfjsDestroy` schedules a fresh 60 s. Probably OK in
    practice but the lifecycle is hand-rolled with no test covering
    interleaved start/finish.

23. **`cancelRender` cannot tell which active worker is doing what.**
    `cancelRender.ts:26-32` reads `renderQueueStore.value.entries`,
    finds the entry for `phraseId`, and terminates the
    pipeline-matched worker. But `entries` is updated by
    `enqueueRender`/`updateRenderStatus` and only filtered out by
    `cancelQueuedRender`. If the user cancels a phrase whose entry
    has already been removed (e.g. timing race with a completion
    callback), `entry?.pipeline` is undefined → falls into the
    `else` branch → terminates the ONNX worker — even if the only
    in-flight render was DDSP. There is no positive correlation
    between `requestId` and `worker` that survives cancellation.

24. **`renderDiffSingerPhrase` loads six sessions sequentially with
    no dedup.** `renderDiffSingerPhrase.ts:169-187`. Each
    `loadOnnxSession` call posts `create-session` with the entire
    model `ArrayBuffer` over `postMessage` (transferred). For a
    voicebank already loaded in the worker, this **re-transfers
    115–160 MB** for nothing — the worker side hits the
    `sessionCache.get(modelId)` happy path at
    `onnxInferenceWorker.ts:102-105` and discards the data, but the
    main-thread `readModel` already paid the OPFS read and the
    buffer transfer. Add a "session-loaded" check on the bridge
    side (a `Set<string>` of known modelIds).

25. **`renderDiffSingerPhrase` reads the model **per render**, not
    per session.** `renderDiffSingerPhrase.ts:170` `await readModel({
... })` for each of the five sub-models on every phrase render —
    even when nothing has changed. With OPFS reads at ~150 MB/s, a
    115 MB voicebank costs ~1 s of disk time on every render. Cache
    bridge-side as in #24, or trust the worker's `sessionCache` and
    skip the read.

26. **`renderDiffSingerPhrase` cache key is timing-fragile.**
    `renderDiffSingerPhrase.ts:104-112` builds the cache key from
    `Math.round(node.startSec * 1000)` and `Math.round(node.durationSec
* 1000)`. Two notes that differ by < 0.5 ms (e.g. quantised vs
    not-quantised by 0.4 ms) produce the same cache key — the
    user's edits silently miss the cache invalidation.
    Render-quality (`steps`) is included in `qualityParams` but not
    in `inputData`; `renderQuality = 'standard'` and
    `renderQuality = 'high'` produce different cache files (good),
    but `depth = 0.6` vs `depth = 0.7` only changes one byte in
    `inputData` — fine.

27. **`renderKokoroTts.fetchVoiceStyle` cache is unbounded module
    state.** `renderKokoroTts.ts:37` `const voiceEmbeddingCache =
new Map<string, Float32Array>()`. With 21 voices × ~500 KB =
    ~10 MB max — small. Not racing-safe (two concurrent
    `fetchVoiceStyle('alloy', ...)` both observe `undefined`, both
    issue `fetch`, last write wins). Same Promise-coalesce miss as
    elsewhere.

28. **`renderKokoroTts` sends voice-id requests to HuggingFace on
    every fresh page load.** `renderKokoroTts.ts:51` `${KOKORO_VOICES_BASE}/${voiceId}.bin`
    is fetched into the module-level `Map`. Page reload → fetch
    again. The model ONNX is cached in OPFS; the voice embedding
    files (~500 KB each) are **not**. There is no OPFS write in
    `fetchVoiceStyle`; `storageManager` has no concept of "voice".
    A user with offline access cannot change voice without network.

29. **`renderKokoroTts` time-stretch by re-resampling is incorrect
    for music.** `renderKokoroTts.ts:172-184`: when
    `targetDurationSec` differs from the rendered duration by > 1%,
    the code calls `resampleTo44100` again with a fictitious source
    sample rate (`Math.round(44100 * stretchRatio)`). This is
    **rate-pitch-coupled** time-stretch — pitch shifts with rate.
    For "scratch tracks" this is vaguely OK at small ratios but the
    docstring promises "time-stretch", which musicians read as
    pitch-preserving. Either rename to "rate-shift" or use a real
    PSOLA / phase-vocoder. (The same `resampleTo44100` is reused;
    no separate rate-shift path.)

30. **`audioResampler.float32ToAudioBuffer` creates an `AudioContext`
    and immediately closes it.** `audioResampler.ts:46-52` `const ctx
= new AudioContext({ sampleRate }); … void ctx.close();`. Each
    call materialises a real `AudioContext`. Browsers cap the number
    of `AudioContext` instances per origin (~6 in Chrome). On a hot
    path (preview clicks), this hits the cap and throws. Use
    `OfflineAudioContext.createBuffer` directly or share a global
    AudioContext (e.g. `getAudioContext()` from `AudioEngine`).
    Note: this function is exported but **unused** anywhere in the
    repo (the previews use `getAudioContext`/`audioBufferCache`
    directly in `AiRenderClipPreview.tsx`).

31. **`audioResampler.normalizePeak` mutates inputs and divides by
    peak that may be `Infinity`/`NaN`.** `audioResampler.ts:72-86`.
    For a NaN-laden input (e.g. ONNX produced NaN due to numerical
    instability), `peak` becomes NaN, the `peak > 0 && peak !== 1`
    check fails (`NaN > 0` is false), and the function silently
    no-ops. Better: `Number.isFinite(peak) && peak > 0` and clamp,
    plus `if (Number.isNaN(sample)) audio[index] = 0`.

32. **`audioResampler.applyFades` and `normalizePeak` use `?? 0`
    fallback on typed-array indices.** `audioResampler.ts:62-65,83`
    `audio[index] ?? 0`. Typed-array reads never return `undefined`
    for in-range indices and return `undefined` for out-of-range
    indices (so `?? 0` only matters for OOB). With the explicit
    bounds (`fadeLen = min(fadeSamples, audio.length / 2)`) this is
    dead defensive code. AGENTS.md "Code should self-explain" — drop
    the `?? 0`.

33. **`ddspInstrumentCatalog` ships hard-coded HuggingFace + Google
    Storage URLs as the only model source.**
    `ddspInstrumentCatalog.ts:25-91`. No fallback CDN, no
    integrity hash (`sha256` is optional, all entries omit it). A
    repo takedown or HuggingFace outage breaks every browser AI
    feature. This is a deployment-architecture risk, not a code bug.
    There is also no telemetry that detects when a CDN starts
    serving a different file (no SHA validation = no detection).

34. **`midiToDdspInput` envelope math is off-by-frame for short
    notes.** `services/midiToDdspInput.ts:74-80`: when `noteFrame <
attackFrames` AND `noteFrame > noteLength - releaseFrames`, the
    release branch wins (later condition), but for a 5-frame note
    with a 5-frame attack and a 5-frame release, every frame
    matches the release condition `noteFrame > 5 - 5 = 0`, so the
    note is **all release, no attack**. Correctness only on long
    notes. The branch order also means a note shorter than `attack
+ release` has overlapping/conflicting envelope segments.

35. **`midiToDdspInput.loudnessDb` formula is dB-of-gain on
    velocity-derived dB.** `services/midiToDdspInput.ts:83`
    `targetDb + 20 * Math.log10(gain)` is correct for converting a
    linear envelope gain to a dB offset on a dB target — but
    `targetDb` itself was derived from
    `velocityToDb(velocity) = 20 * Math.log10(velocity / 127)`
    (`audioResampler.ts:100-105`). Velocity 64 → −5.96 dB target,
    gain 0.5 → −5.96 + (−6.02) = −11.98 dB total. That's
    correct; just flagging the chain because DDSP loudness is
    A-weighted dB-of-acoustic-level, not "dB of velocity" — the
    DDSP decoder will receive a curve that looks reasonable to the
    decoder only by happy accident.

36. **`midiToDdspInput` is never actually called from a use case.**
    `services/midiToDdspInput.ts` is exported from the file but no
    code in `BrowserAi/` imports it (DDSP is stubbed — issue #2).
    Dead code shipping.

37. **`audioResampler.float32ToAudioBuffer` and
    `audioResampler.midiToHz`/`velocityToDb` are unused outside
    `services/midiToDdspInput.ts`.** Same dead-code risk. Once #36
    is resolved, several helpers can be deleted.

38. **`kokoroTokenizer.textToKokoroInputIds` truncates at 510 tokens
    silently.** `services/kokoroTokenizer.ts:211-215`: a 600-token
    input is truncated to 510 with no warning, no callback, no UI
    indicator. The user types a long passage; the second half
    silently disappears.

39. **`kokoroTokenizer` drops unknown phonemes silently.**
    `services/kokoroTokenizer.ts:201-203`: `if (ids) tokenIds.push(...ids)`
    — phonemes not in `ARPABET_TO_KOKORO_IDS` are dropped, no log.
    The phonemizer can produce stress markers and odd ARPAbet
    variants that are never in this map.

40. **`phonemizer.parsePhonemesTxt` mis-names parameters.**
    `services/phonemizer.ts:1135-1144` `lines.map((length) =>
length.trim())` and `for (let index = 0; index < lines.length;
index++) { map[lines[index]!] = index; }` — `length` is the
    callback parameter for `lines.map`, not a length. Confusing,
    not buggy.

41. **`phonemizer.phonemize` strips apostrophes via tokenisation,
    not lookup.** `services/phonemizer.ts:1086-1089` splits on
    `[\s,.\-!?;:'"()[\]]+` — `don't` → `dont` → exception dict
    catch. But `i'm` → `im` → exception dict catch (`im: ['AY',
'M']` exists). `it's` → `its` → exception dict (`its: ['IH', 'T',
'S']`). The tokeniser silently merges contractions. For lyrics
    where the apostrophe matters (singing "you're" vs "your"), the
    pronunciation in the dict happens to coincide; a slight
    mismatch will surface for any apostrophe word not pre-listed
    (`he'll` → `hell` is in the dict at `'hell'` mapped to `[HH,
IY, L]` not the swear word — coincidental correctness).

42. **`phonemizer.G2P_RULES` rule ordering is fragile and untested.**
    `services/phonemizer.ts:896-996` is ~100 ordered rules with
    explicit comments about most-specific-first. Adding a new rule
    in the wrong place silently changes ARPAbet output for some
    fraction of words. There is **no test** that pins the
    expected ARPAbet output for a representative dictionary of
    English words. Any future regression goes uncaught.

43. **`getStorageStatus` walks **the entire OPFS root**, not just
    `models/` and `renders/`.** `repositories/storageManager.ts:182-208`
    `measureDir(root)` recursively totals every file under
    `navigator.storage.getDirectory()`. If any other module or any
    third-party library writes to OPFS, those bytes count against
    the BrowserAi limit. Should be `measureDir(modelsDir) +
measureDir(rendersDir)`.

44. **`getStorageStatus` async iteration uses an `as
AsyncIterable<...>` cast.** `repositories/storageManager.ts:192-193`.
    Justified by lib.dom.d.ts not typing OPFS iteration, but it is
    still a soundness escape per AGENTS.md. Add a typed wrapper or
    a single `// @ts-expect-error -- lib.dom missing OPFS iterator
typings; remove when TS 5.5+` with a removal path.

45. **`storageManager.requestPersistentStorage` is a non-injected
    bare function.** `repositories/storageManager.ts:238-244` is
    plain `async function`, not `inject(...)`-wrapped like its
    neighbours. Inconsistent with the rest of the file.

46. **`storageManager.computeRenderCacheKey` is a non-injected
    bare function and exports as a top-level utility.** Same shape
    issue as #45. AGENTS.md: "All I/O ... goes in repositories";
    `computeRenderCacheKey` is pure (it just hashes), so it should
    live in `services/` instead.

47. **OPFS path scheme conflates "family" with "voicebank id" for
    DiffSinger.** `useCases/renderDiffSingerPhrase.ts:170` reads
    with `family: 'diffsinger/${voicebankId}'`, but `family` in
    `BrowserModel.ModelFamily` is an enum
    (`'diffsinger-linguistic' | 'diffsinger-dur' | …`). The
    download manager writes with whatever `spec.family` the caller
    gave. The `ModelManagerPanel.VoicebankAction.handleRemove`
    works around this by passing `opfsFamily =
'diffsinger/${voicebank.id}'` and explicitly noting "do not use
    `model.family`". This _string-vs-enum_ mismatch is a foot-gun:
    a code path that mistakenly uses the enum will silently look in
    the wrong OPFS directory.

48. **`storageManager.checkModelCached` swallows the actual error
    in the `catch`.** `repositories/storageManager.ts:87-90`:
    `catch { logger.info(...); return false }`. A permissions
    error, a corrupt OPFS, or a transient I/O error all look like
    "not cached". The user clicks "download" again; the download
    succeeds; nothing was wrong. Also: the `logger.info` is
    incorrectly emitted on _every_ check including normal "not
    cached" — should be `debug`.

49. **`writeModel.slice(0)` allocates a copy of the model bytes.**
    `repositories/storageManager.ts:120` "ensures we have a plain
    ArrayBuffer (not SharedArrayBuffer)". For a 235 MB Demucs ONNX
    or a 115 MB DiffSinger acoustic, this doubles peak heap. The
    SAB check is reasonable in theory but in this codebase
    `downloadModel` always produces a plain ArrayBuffer
    (`fullData.buffer` from a fresh `Uint8Array`). The slice is
    dead defensive code with a real cost.

50. **`writeModel` writes a single chunk via `createWritable`.**
    `repositories/storageManager.ts:121-123`. For a 1 GB ONNX
    voicebank, `writable.write(safeData)` blocks the main thread
    until the write completes (createWritable on the main thread
    has no streaming back-pressure in practice). Move OPFS writes
    to a worker via `getFileHandle().createSyncAccessHandle()` for
    real throughput.

51. **`modelDownloadManager` stores **all chunks in JS heap** before
    writing.** `repositories/modelDownloadManager.ts:86-115`. A
    1 GB voicebank lives in a `Uint8Array[]` plus the merged
    `fullData = new Uint8Array(totalLength)` plus `onnxData =
onnxBytes.slice(0).buffer` after unzip — ~3× peak. Browsers
    will OOM on weak devices. Stream directly to a
    `FileSystemWritableFileStream` while reading.

52. **`modelDownloadManager.broadcast` constructs and closes a
    BroadcastChannel **per progress event**.**
    `repositories/modelDownloadManager.ts:54-63`. With chunks
    arriving every few ms and `broadcast` called inside the read
    loop, this is hundreds-to-thousands of BC create/post/close
    cycles per download. Hold a single channel for the duration of
    the download.

53. **`modelDownloadManager` retries do not respect cancellation.**
    `repositories/modelDownloadManager.ts:67-191`: the for-loop
    retries up to 3× with `await sleep(1000 * 2 ** attempt)`. There
    is no `AbortController` plumbed through. A user who cancels a
    download mid-flight cannot interrupt the retry sleep; the
    download will eventually complete (or fail) and update the
    store after the user has long moved on.

54. **`modelDownloadManager` `updateModelStatus` calls during
    streaming are unthrottled.**
    `repositories/modelDownloadManager.ts:98`. Every chunk →
    immutable `state.update` → store subscribers re-fire. With
    React 19's compiler-driven render-on-store-change, every
    `useStore(modelRegistryStore, ...)` re-runs on every chunk.
    Throttle to ~10 Hz.

55. **`modelDownloadManager` SHA-256 verification happens **after**
    the bytes are fully in memory.**
    `repositories/modelDownloadManager.ts:120`. Reasonable for now
    (1 GB max), but the architecture forecloses streaming hash
    (`crypto.subtle.digest` is one-shot). For larger models a
    streaming SHA-256 (hash-stream) is needed — flag for future.

56. **`modelDownloadManager` does not enforce the LRU eviction it
    advertises.** `repositories/modelDownloadManager.ts:166-170`:
    "LRU eviction is handled by the removeModel use case" — but
    `removeModel` only deletes a specific model the caller names.
    There is no automatic eviction. The 2 GB cap is not enforced;
    it is only logged. A user with patience can fill OPFS until
    `navigator.storage.estimate` quota is exhausted, after which
    `writeModel` throws and the next download fails silently
    (caught by `downloadModel`'s try/catch and turned into a
    `status: 'error'`).

57. **`unzip` from `fflate` is async but the buffer is not freed
    after extraction.**
    `repositories/modelDownloadManager.ts:142-160`. After `files`
    is destructured, the original `fullData` (the entire ZIP) is
    still referenced by the outer scope until the function returns.
    For a 1 GB voicebank ZIP with five 200 MB ONNX files, peak
    heap is the merged buffer + the unzipped files.

58. **`modelRegistryStore.updateModelStatus` rebuilds **every
    voicebank** on every patch.**
    `stores/modelRegistryStore.ts:47-57`: `updatedVoicebanks =
state.diffSingerVoicebanks.map(vb => ({ …vb, models: { … } }))`
    creates fresh object identities for every voicebank's `models`
    sub-tree even when the patch targets an unrelated model. With
    100+ subscribers on `modelRegistryStore`, this is N×M
    re-renders per chunk during download (compounding #54).

59. **`renderQueueStore.markRenderComplete` keeps stale entries
    forever.** `stores/renderQueueStore.ts:62-82`: status flips to
    `preview` but the entry stays in `entries`. Over a session
    this grows monotonically — every render is a new entry. There
    is no cap. `cancelQueuedRender` is the only path that removes
    entries.

60. **`renderQueueStore.cachedPhraseIds` is keyed by `cacheKey`,
    `phraseStatusMap` is keyed by `phraseId` — silently divergent.**
    `stores/renderQueueStore.ts:24-25,72-79`. The "cached" set uses
    a content-derived hash; the "status" map uses the user-facing
    phrase identity. There is no path to look up "is this phrase's
    cached audio still on disk?" without scanning OPFS.

61. **`inferenceProgressStore.updateActiveRenderProgress` silently
    drops updates for unknown requestIds.**
    `stores/inferenceProgressStore.ts:32-56`. A worker progress
    message that arrives just after `clearActiveRender` (e.g. due
    to message ordering vs `try { … } finally { clearActiveRender
}`) is dropped. The user sees "render done" without seeing 100%.

62. **`initBrowserAi.midiStaleSubscription` retains the previous
    notesByClipId by reference.**
    `useCases/initBrowserAi.ts:133-155`: `prevNotesByClipId =
midiStore.value?.notesByClipId ?? {}` and the subscription
    closure reassigns `prevNotesByClipId = nextNotesByClipId`.
    For a `notesByClipId` containing thousands of clips, this
    holds onto a snapshot for the duration of every subscription
    invocation. Memory-stable in steady state but the closure
    captures one extra snapshot per HMR (since
    `midiStaleSubscription?.()` only calls the unsubscribe; the
    closure retained by the now-dead handler is gone, but a chain
    of HMR reloads accumulates).

63. **`initBrowserAi` does not handle the case where `midiStore`
    has not been initialised yet.** `useCases/initBrowserAi.ts:133`
    `midiStore.value?.notesByClipId ?? {}`. If `MIDI` initialises
    after `BrowserAi`, the subscription's first invocation will
    compare `{}` against a populated `nextNotesByClipId` — every
    clip will look "changed" and every rendered phrase will be
    marked stale on the first MIDI hydration.

64. **`initBrowserAi` populates `ddspInstruments` with `status:
'ready', downloadProgress: 1`** even when the TF.js worker is
    stubbed (issue #2). `useCases/initBrowserAi.ts:89-93`.

65. **`AiRenderClipPreview.cacheAudioBuffer` allocates a new
    `bufferId` on first play but never evicts.**
    `presentations/views/AiRenderClipPreview.tsx:28-35`. Every
    rendered phrase that the user previews puts a new `AudioBuffer`
    into `audioBufferCache` (cross-module from `AudioEngine`).
    There is no removal. Over a session, the cache grows
    monotonically. No cleanup on component unmount.

66. **`AiRenderClipPreview` `bufferIdRef.current!` non-null assertion
    immediately after `ensureBufferId()`.** `:60` `audioBufferCache.get(bufferIdRef.current!)`.
    `ensureBufferId` returns the id but the code re-reads from the
    ref. A bug where `ensureBufferId` set the ref to `null` would
    crash here; mainly type-soundness nit but the pattern is
    fragile.

67. **`AiRenderClipPreview` `source.onended` race.** `:68-75` the
    comment acknowledges "stopped source's onended from clobbering
    a new playback". The fix (`if (sourceRef.current === source)`)
    works for the documented case, but it does not handle the case
    where `setIsPlaying(true)` fires for a new source, then the
    new source completes, _and_ the old `onended` hasn't fired yet
    (rare — but the cleanup of the old source's reference to
    `setIsPlaying(false)` is gated only on identity, leaving the
    user's UI in `playing` while audio is silent).

68. **`KokoroVoiceSelector` packs accent+gender into a `${accent}|${gender}`
    GroupKey and parses by `indexOf('|')`.**
    `presentations/views/KokoroVoiceSelector.tsx:25,58-62`. The
    comment "accent/gender values never contain '|'" is true today
    but is a fragile assumption. A model expansion that adds an
    accent like `'en-uk|us'` (it could happen) silently breaks
    grouping. Use a tuple `Map<[string, string], …>` or a discriminated
    object key.

69. **`ModelManagerPanel.formatBytes` uses a 3-branch ladder that
    differs from `getStorageStatus`/`requestPersistentStorage`
    pieces.** `presentations/views/ModelManagerPanel.tsx:35-43`.
    Cosmetic; flag because there are at least 4 places in the
    codebase that format byte sizes with subtly different
    breakpoints — a shared util belongs in `utils/`.

70. **`ModelManagerPanel.VoicebankAction.handleRemove` is **not
    awaited** for any of the 5 sub-deletes.**
    `presentations/views/ModelManagerPanel.tsx:154-156`:
    `for (const key of [...]) { void removeModel({ ... }); }`.
    All five OPFS deletes fire concurrently. If one fails, no UI
    feedback. If the `getStorageStatus` poll runs between deletes,
    the storage bar shows partial state.

71. **`ModelManagerPanel` re-builds the `KOKORO_MODEL_SPEC` /
    `VOCODER_MODEL_SPEC` objects locally** instead of importing
    `KOKORO_MODEL_ENTRY` / `NSF_HIFIGAN_VOCODER` from
    `useCases/initBrowserAi`. Two sources of truth:
    `presentations/views/ModelManagerPanel.tsx:21-33` vs
    `useCases/initBrowserAi.ts:33-58`. A change to the model id
    or family in one place leaves the other stale.

72. **AGENTS.md function signature violations.** Several functions
    take positional parameters where AGENTS.md mandates a single
    `<FunctionName>Input` object:
    - `services/audioResampler.ts:46` `float32ToAudioBuffer(audio,
sampleRate)` (2 params)
    - `services/audioResampler.ts:58` `applyFades(audio, fadeSamples)`
    - `repositories/storageManager.ts:31`
      `resolveFileHandle(opfsRoot, relativePath, options)` (3 params)
    - `workers/onnxInferenceWorker.ts:101`
      `getOrCreateSession(modelId, modelData)`
    - `workers/onnxInferenceWorker.ts:127`
      `tensorDataToOrt(ort, td)`
    - `workers/onnxInferenceWorker.ts:161`
      `broadcastSpkEmbed(ort, embed, nFrames)`
    - `workers/onnxInferenceWorker.ts:173,337`
      `runDiffSingerPipeline(requestId, sessions, ort, params)`
      and `runKokoroOnnx(requestId, inputIds, style, speed)`

73. **One-function-per-file violations in `useCases/`.**
    `useCases/initBrowserAi.ts` exports `initBrowserAi`,
    `KOKORO_MODEL_ENTRY`, `NSF_HIFIGAN_VOCODER`,
    `KOKORO_VOICE_CATALOG`, `DDSP_INSTRUMENT_CATALOG`, and re-exports
    `type RenderQuality`. AGENTS.md "**One Function Per File:**
    Every `useCase` and `repository` file must export exactly ONE
    function." The catalogs and constants belong in `models/`; the
    re-export of `RenderQuality` belongs in the (missing) module
    barrel.

74. **Use-case `index.ts` re-exports two non-functions.**
    `useCases/index.ts:4` re-exports `KOKORO_MODEL_ENTRY` and
    `NSF_HIFIGAN_VOCODER`. AGENTS.md "From `useCases/`, re-export
    runtime values (functions, constants) only — not `export type`."
    Constants are runtime values so this is allowed; flag for
    consistency since a future reader will expect only functions.

75. **`stores/index.ts` is a barrel that re-exports four stores.**
    AGENTS.md: "**Barrel files:** Do not add `index.ts` barrels …
    **except** each module's **root** `index.ts`." `stores/index.ts`
    is _not_ the root barrel; it is a per-folder barrel.

76. **`presentations/views/index.ts` is a barrel.** Same rule as
    #75. The module has no root `index.ts` (issue #1) and three
    per-folder barrels (`stores/`, `useCases/`, `events/`,
    `presentations/views/`).

77. **Type-soundness escapes (`as unknown as …`).**
    - `workers/onnxInferenceWorker.ts:60-61`
      `(await import('onnxruntime-web')) as unknown as OrtModule`,
      with an `eslint-disable sourdaw/no-type-assertion-escape`. Justified
      with prose; AGENTS.md still requires a removal path.
    - `workers/onnxInferenceWorker.ts:428` `val.data as Float32Array`
      (issue #19).
    - `repositories/inferenceWorkerBridge.ts:189,197,204` `response
as Extract<...>` (issue #20).
    - `repositories/storageManager.ts:168` `audio.buffer.slice(0) as
ArrayBuffer` — slice already returns ArrayBuffer; the `as` is
      dead.
    - `repositories/storageManager.ts:192-193` `as AsyncIterable<...>`.
    - `repositories/capabilityDetector.ts:64-65` `(navigator as {
gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter()`
      — see #78.
    - `presentations/views/ModelManagerPanel.tsx:267`
      `'status' in instrument ? (instrument as { status: string
}).status : undefined`.

78. **`CapabilityReportPanel` reads
    `(navigator as { gpu: ... })` instead of
    `Navigator.gpu`.** `repositories/capabilityDetector.ts:62-65`.
    `navigator.gpu` _is_ in modern lib.dom.d.ts (TS 5.x). The cast
    is stale.

79. **No tests anywhere in the module.** Zero `__tests__/`,
    zero `*.spec.ts`, zero `*.test.ts`. The most accident-prone
    surfaces — phonemizer rules (#42), tokenizer truncation (#38),
    LRU eviction race (#11–13), download retry (#53), worker
    lifecycle (#22), capability cache (#4–6), envelope math (#34) —
    have no behavioural coverage. AGENTS.md "Force Empirical Proof"
    cannot be satisfied for this module.

80. **Worker bridge async functions are `async` only for protocol
    uniformity.** `repositories/inferenceWorkerBridge.ts:75-76,88-89,207-208,216-217`
    each carry an `eslint-disable
@typescript-eslint/require-await` with the comment "fire-and-forget
    postMessage; async for uniform bridge API". The "uniform API"
    rationale matches the AudioAnalysis audit issue #15 which was
    flagged there. The fix is the same: split sync (no requestId)
    from async (with requestId) into separate methods.

81. **`workers/onnxInferenceWorker.ts:79` uses `console.warn`
    directly.** Workers do not have access to the app `logger`
    (it's a main-thread DI); fair enough. But `console.warn` is
    inconsistent with the bridge that posts `inference-progress`
    messages — a runtime log channel should be a typed
    `WorkerResponse` of `{ type: 'log', level, message }` so the
    main thread can route to the same logger.

82. **PII: lyric text never leaves the browser, but search the
    request URL.** `useCases/renderKokoroTts.ts:51`
    `${KOKORO_VOICES_BASE}/${voiceId}.bin`. Only the voice id is in
    the URL. _However_, the cache key is computed by hashing the
    text + speakerId + speed (`renderKokoroTts.ts:101-106`); the
    cache file name in OPFS is the SHA-256 hex of that
    concatenation. The cache file _persists_ user prompts as
    hash-derived names. A forensic analyst with OPFS access can
    enumerate cache files but cannot reverse the hash to recover
    text. Confirms PII isolation. Note: the cache key in
    `renderDiffSingerPhrase.ts:104-118` includes the **lyrics**
    in `inputData` before hashing — same property, same conclusion.

83. **PII: `localStorage` `sourdaw-browser-ai-capability` carries
    `chromeVersion`, `benchmarkMs`, `detectedAt`, `sharedArrayBuffer`
    bool.** `repositories/capabilityDetector.ts:154`. None of these
    are PII per se; they form a fingerprint vector. Worth flagging
    because the cache survives all-cookie clears (localStorage is
    not cleared by "Clear cookies" in some browsers).

84. **PII: BroadcastChannel name `sourdaw-model-downloads` is
    cross-tab visible.** `repositories/modelDownloadManager.ts:22`.
    Any cross-origin tab from the same origin (e.g. an embedded
    iframe) can listen and learn which AI models the user is
    downloading. This is by design (cross-tab progress sync) but
    not documented as a privacy property.

85. **No back-pressure between main-thread render orchestration and
    the worker.** `useCases/renderKokoroTts.ts` and
    `useCases/renderDiffSingerPhrase.ts` `await
inferenceWorkerBridge.run...` and that's the only synchronisation.
    A user clicking "render" rapidly on multiple phrases queues
    arbitrarily many concurrent ONNX inferences in the worker; the
    worker processes them sequentially via the await chain inside
    its message handler — wait, **does it?** `onnxInferenceWorker.ts:380`
    `self.onmessage = async (event) => { ... }` — JS workers
    process messages from their event queue one-at-a-time, but
    **async handlers inside `self.onmessage` interleave** because
    they each `await` and yield. Two `run-diffsinger-phrase` arrive
    back-to-back: handler #1 starts, awaits `runDiffSingerPipeline`,
    yields to the event loop, handler #2 starts on the next tick,
    awaits its own pipeline. Both pipelines now interleave on the
    worker's microtask queue — six diffusion-step `session.run()`
    calls per pipeline, all racing on the same `sessionCache`. The
    LRU `lastUsedAt` updates clobber each other; concurrent runs of
    the same session may corrupt internal ORT state. **No
    serialisation.** Add a `Promise` chain in the worker to
    serialise inferences.

86. **Worker does not unwind partially-loaded sessions on error.**
    `workers/onnxInferenceWorker.ts:489-545`: a thrown error inside
    `runDiffSingerPipeline` (e.g. an OOM during step 4) leaves the
    sessions allocated. The main-thread cancellation path
    (`terminateOnnxWorker`) tears the whole worker down — sessions
    leak only insofar as the worker itself is GC'd. But the worker
    is respawned next call, which means **all sessions reload from
    OPFS again**. Cumulative "render → error → retry" cycles
    re-pay the full session-load cost.

---

## Priorities

1. **No tests, no spec, no module barrel** (issues #1, #79) —
   cross-module imports are deep-pathed in violation of AGENTS.md;
   the entire module ships uncovered.
2. **Worker concurrency / interleaving** (issue #85) — concurrent
   `run-diffsinger-phrase` messages interleave on the worker's
   microtask queue; sessions shared across pipelines without
   serialisation.
3. **DDSP feature is fake** (issue #2) — UI promises a feature that
   the worker explicitly disables; users get errors.
4. **Lazy-singleton races, no Promise-coalesce** (issues #10, #17,
   #27) — concurrent first-callers all start initialisation; last
   write wins; first writer's state is leaked.
5. **`cancelRender` is a sledgehammer** (issues #8, #23, #9) —
   per-request cancellation is undefined; `AbortController` field
   is dead; cancelling A kills B.
6. **Capability detection is misleading** (issues #3, #4, #6) — the
   "benchmark" times adapter discovery; the localStorage cache has
   no schema versioning.
7. **OPFS cache discipline** (issues #43, #56, #58) — root-level
   measurement; no LRU enforcement; full-tree rebuild on every
   patch.
8. **Memory hot spots** (issues #14, #15, #49, #51) — no GPU
   tensor disposal; budget under-counts real footprint; download
   manager triples model bytes in heap.
9. **AGENTS.md compliance pass** (issues #72, #73, #75–77) —
   positional args, multi-export use cases, sub-folder barrels,
   `as` escapes — accumulated debt.
10. **DSP / phonemizer correctness gaps** (issues #29, #34, #38,
    #41, #42) — silent truncation, broken envelopes, untested
    G2P rule order.

---

## Open issues

### 1. No module root `index.ts` — every cross-module consumer reaches into sub-paths

**Problem:** `src/modules/BrowserAi/` has no `index.ts`. The four
external consumers import from `…/useCases`, `…/stores`, and
`…/presentations/views`. AGENTS.md requires a single root barrel as
the cross-module surface; sub-path imports bypass it.

**Representative files:**

- `src/app/bootstrap.ts:34`
- `src/modules/Workspace/presentations/views/StatusBar.tsx:14`
- `src/modules/Workspace/presentations/views/preferences/AiSection.tsx:10`
- `src/modules/Workspace/presentations/views/Inspector/ClipMidiAiSection.tsx:15-23`

**Needed:** Create `src/modules/BrowserAi/index.ts` that re-exports
the public contract (`useCases/`, `stores/`, `events/`,
`presentations/views/`). Update the four consumers to import from
`#/modules/BrowserAi`. Run `pnpm deps:validate` to enforce.

### 2. DDSP is shipped as "ready" but the TF.js worker is a deliberate stub

**Problem:** `tfjsInferenceWorker.ts:16` returns
"DDSP browser rendering is not available" for every request. Yet
`initBrowserAi.ts:89-93` populates the registry with four DDSP
instruments at `status: 'ready', downloadProgress: 1`, and
`ModelManagerPanel.tsx:266-290` shows them as "✓ Cached". A user
clicking "render" via DDSP gets an error.

**Representative files:**

- `src/modules/BrowserAi/workers/tfjsInferenceWorker.ts:16-43`
- `src/modules/BrowserAi/useCases/initBrowserAi.ts:89-93`
- `src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx:260-290`

**Needed:** Either bundle TF.js (resolve the Rolldown blocker the
worker comment cites) or mark DDSP entries with an explicit
`'unavailable'` status, hide them from the model manager, and remove
the catalog entries from `KOKORO_VOICE_CATALOG`/`DDSP_INSTRUMENT_CATALOG`
exports. Do not ship features that don't work.

### 3. `runWebGpuBenchmark` measures adapter acquisition, not GPU compute

**Problem:** `capabilityDetector.ts:57-76` times
`requestAdapter()`. Adapter discovery completes before any compute
shader runs. Devices with slow GPUs but fast adapter discovery are
classified `webgpu-fast`. The 50/500 ms thresholds are calibrated
against a metric that is not GPU performance.

**Representative files:**

- `src/modules/BrowserAi/repositories/capabilityDetector.ts:57-89`

**Needed:** Run an actual minimal compute shader (e.g. a
fixed-size matmul via WebGPU compute pipeline, or a tiny ONNX
session) and time the round-trip. Cache the result with a schema
version; invalidate on `chrome` major version bump.

### 4. Capability cache has no schema version, never expires

**Problem:** `capabilityDetector.ts:99-110,151-158` reads/writes
`localStorage` directly without a `version` field. A change to
`CapabilityReport` shape leaves every user on a stale cache.
Corrupt JSON is swallowed silently and the corrupt value stays.

**Representative files:**

- `src/modules/BrowserAi/repositories/capabilityDetector.ts:16,99-158`

**Needed:** Add a `version: 1` field; bump on shape changes; on
mismatch delete the cache and re-detect. On parse error
`localStorage.removeItem(STORAGE_KEY)`. Add an expiry
(`detectedAt + 30 days`).

### 5. Lazy-singleton races: workers, ONNX module, voice embeddings

**Problem:** `inferenceWorkerBridge.getOnnxWorker`/`getTfjsWorker`,
`onnxInferenceWorker.getOrt`, and `renderKokoroTts.fetchVoiceStyle`
all use the same antipattern: check `holder === null`, await an
init, assign. Concurrent first callers each see `null`, each run
the init, last write wins; earlier writes leak the partially-
initialised resource. For a 235 MB ONNX session this is OOM-class.

**Representative files:**

- `src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts:76-86,89-105`
- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts:55-72`
- `src/modules/BrowserAi/useCases/renderKokoroTts.ts:37,47-71`

**Needed:** Promise-coalesce: store
`holder.promise: Promise<T> | null`; on first call assign
`holder.promise = init()`; subsequent calls return the same
Promise. Same pattern in three places.

### 6. Worker-side request interleaving — pipelines race on shared sessions

**Problem:** `onnxInferenceWorker.ts:380` `self.onmessage = async
(event) => { ... }`. Two consecutive `run-diffsinger-phrase`
messages enter parallel async chains; their `session.run(...)`
calls interleave on the worker's microtask queue. The session
cache is shared module-level state — two diffusion pipelines
running concurrently update `lastUsedAt` non-monotonically and
may corrupt ORT internal state.

**Representative files:**

- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts:380-545`

**Needed:** Serialise inferences in the worker. One pattern:
maintain a `currentInference: Promise<unknown> = Promise.resolve()`
and chain each handler:
`currentInference = currentInference.then(() => handle(req))`.
Add a test that posts two concurrent requests and asserts they
complete in order without interleaving.

### 7. `cancelRender` is a sledgehammer; `AbortController` is dead

**Problem:** `cancelRender.ts:21-37` calls
`terminateOnnxWorker`/`terminateTfjsWorker` on the worker that
matches the cancelled phrase's pipeline. This rejects **every**
in-flight request on that worker, not just the cancelled one.
`ActiveRender.abortController` is declared in
`models/RenderProgress.ts:63` but is `Omit`-stripped from every
store and never instantiated.

**Representative files:**

- `src/modules/BrowserAi/useCases/cancelRender.ts:21-37`
- `src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts:231-265`
- `src/modules/BrowserAi/models/RenderProgress.ts:63`
- `src/modules/BrowserAi/stores/inferenceProgressStore.ts:14,21`

**Needed:** Per-request cancellation. Add `cancel-request` to
the worker protocol; the worker tracks an in-flight Promise
keyed by `requestId` and resolves it with a sentinel error when
asked to cancel. Plumb a real `AbortController` through
`startActiveRender` (drop the `Omit`); on cancel, call
`abortController.abort()` and post `cancel-request` to the
worker. Stop terminating workers as a cancellation primitive.

### 8. No tensor disposal in DiffSinger pipeline → GPU memory accretion

**Problem:** `runDiffSingerPipeline` produces 12–15 intermediate
tensors (`encoderOut`, `xMasks`, `phDur`, `pitchPred`, `energyPred`,
`breathinessPred`, `mel`, `waveform`, plus per-stage feeds) and
never disposes them. WebGPU-backed tensors retain GPU memory
until JS GC plus the runtime's own collection pass. Across many
renders, GPU memory creeps until `ort.InferenceSession.create`
or a session run fails with an obscure WebGPU error.

**Representative files:**

- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts:184-318`

**Needed:** Add `OrtTensor.dispose()` to the type and call it on
intermediate tensors immediately after their last use. Wrap the
pipeline in a `try/finally` that disposes anything still
referenced. Add a memory-pressure test that runs 50 sequential
DiffSinger renders and asserts no monotonic memory growth.

### 9. LRU eviction in worker is racing-unsafe and accounts file size, not real memory

**Problem:** `onnxInferenceWorker.ts:83-99` is single-pass over
the cache, awaits `release()` while still holding the entry, and
deletes _after_ release. Concurrent `getOrCreateSession` calls
that both push the budget can both pick the same eviction
candidate. `sizeBytes = modelData.byteLength` (`:115`) under-counts
WebGPU activation memory.

**Representative files:**

- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts:83-123`

**Needed:** Delete the cache entry before awaiting `release()`.
Serialise eviction behind a Promise (similar to issue #6). Reduce
`SESSION_MEMORY_BUDGET` to a defensive value (~384 MB) or add a
real-memory probe (`performance.measureUserAgentSpecificMemory()`).

### 10. OPFS storage measurement walks the entire root

**Problem:** `getStorageStatus` in `storageManager.ts:182-208`
`measureDir(root)` totals every file in OPFS, not just BrowserAi's
files. Any other module or library that uses OPFS counts against
the BrowserAi limit.

**Representative files:**

- `src/modules/BrowserAi/repositories/storageManager.ts:182-208`

**Needed:** `measureDir(modelsDir) + measureDir(rendersDir)` only.
Skip `cacheDir`/`renderCacheDir` if they don't exist.

### 11. 2 GB cache limit is logged but never enforced

**Problem:** `modelDownloadManager.ts:166-170` checks the limit
and logs a warning; eviction is "handled by the removeModel use
case" — but `removeModel` only deletes named models. Nothing is
automatic. The cap is decorative.

**Representative files:**

- `src/modules/BrowserAi/repositories/modelDownloadManager.ts:166-170`
- `src/modules/BrowserAi/useCases/removeModel.ts`

**Needed:** Implement `evictOldestUntilUnder(targetBytes)` in
`storageManager` that walks OPFS, sorts by `lastUsedAt` (or
`File.lastModified` as a proxy), and deletes until usage is
under target. Call from `downloadModel` before the write.

### 12. Modeldownload concatenates entire ZIP/ONNX into JS heap; broadcast spam

**Problem:** `modelDownloadManager.ts:86-115` accumulates a
`Uint8Array[]`, then merges into `fullData = new Uint8Array(totalLength)`,
then `unzip` produces yet another set of buffers, then
`onnxBytes.slice(0).buffer` copies again. Peak heap is ~3× model
size. `broadcast` (`:54-63`) creates and closes a
`BroadcastChannel` per progress event.

**Representative files:**

- `src/modules/BrowserAi/repositories/modelDownloadManager.ts:54-115`

**Needed:** Stream chunks directly to a
`FileSystemWritableFileStream` opened on the destination file
(skip the JS-heap accumulation). For ZIPs, stream-unzip with
`fflate.unzip` API that supports streaming, or accept the
double-buffer and free promptly. Hold one `BroadcastChannel` for
the duration of the download.

### 13. Download retry has no AbortController; no streaming hash; updates store unthrottled

**Problem:** `modelDownloadManager.ts:67-191` retries 3× with
exponential backoff and no cancellation path; the store
`updateModelStatus(modelId, { downloadProgress })` fires per
chunk, re-rendering every subscriber on every chunk;
`crypto.subtle.digest` is one-shot and runs after the entire
buffer is in heap.

**Representative files:**

- `src/modules/BrowserAi/repositories/modelDownloadManager.ts:67-191`

**Needed:** Plumb `AbortSignal` through the download path; honour
in `fetch`, `reader.read`, and the retry sleep. Throttle the
per-chunk store updates to ~10 Hz (or to byte-deltas of ~256 KB).
Replace the post-hoc digest with a streaming SHA-256 (e.g. via
`@noble/hashes/sha256`).

### 14. `phonemizer` G2P rules are 100+ ordered rules with zero tests

**Problem:** `services/phonemizer.ts:896-996` is the entire
English G2P engine, ordered most-specific-first. Adding a rule
in the wrong place silently changes ARPAbet output for some
fraction of words. Tokenisation strips apostrophes
(`he'll` → `hell`). Unknown phonemes are dropped silently in
`kokoroTokenizer:201-203`. Long inputs are truncated at 510
tokens silently in `kokoroTokenizer:211-215`.

**Representative files:**

- `src/modules/BrowserAi/services/phonemizer.ts:896-996,1080-1129`
- `src/modules/BrowserAi/services/kokoroTokenizer.ts:184-222`

**Needed:** Pin the G2P engine with a test that runs a
representative dictionary of 200+ English words and asserts the
ARPAbet output. On unknown phonemes / overflow, log a warning
or surface a `RenderResult.warnings` field so the UI can show
"truncated to 510 tokens" or "unrecognised pronunciation".

### 15. `midiToDdspInput` envelope math is wrong for short notes

**Problem:** `services/midiToDdspInput.ts:74-80`. For a 5-frame
note with 5-frame attack and 5-frame release, every frame matches
the release branch (`noteFrame > noteLength - releaseFrames`
becomes `> 0`); the attack branch is dead. Notes shorter than
`attack + release` have undefined envelope.

**Representative files:**

- `src/modules/BrowserAi/services/midiToDdspInput.ts:55-85`

**Needed:** Compute `effectiveAttack = min(attackFrames, noteLength
/ 2)`, `effectiveRelease = min(releaseFrames, noteLength / 2)`,
and check `noteFrame < effectiveAttack` first, then `noteFrame >=
noteLength - effectiveRelease`, with sustain in between.
Note: this whole file is unused while DDSP is stubbed (issue #2).

### 16. Render queue grows monotonically; cache key vs phrase id divergence

**Problem:** `renderQueueStore.markRenderComplete` keeps entries
forever (`:62-82`). `cachedPhraseIds` is keyed by `cacheKey`
(content hash), `phraseStatusMap` is keyed by `phraseId` —
neither can answer "is this phrase's cached audio still on
disk?". Across a session, `entries[]` grows unbounded.

**Representative files:**

- `src/modules/BrowserAi/stores/renderQueueStore.ts:11-107`

**Needed:** Cap entries at e.g. 50 most recent (LRU). Store a
single `cacheKeyByPhraseId: Map<phraseId, cacheKey>` instead of
two unrelated structures. Add a teardown path that fires on
project unload to drop the queue.

### 17. `ModelManagerPanel` and `initBrowserAi` carry duplicate model specs

**Problem:** `ModelManagerPanel.tsx:21-33` constructs
`KOKORO_MODEL_SPEC` and `VOCODER_MODEL_SPEC` locally. The same
data exists at `useCases/initBrowserAi.ts:33-58` as
`KOKORO_MODEL_ENTRY` / `NSF_HIFIGAN_VOCODER`. Two sources of
truth; a model id change updates one and leaves the other stale.

**Representative files:**

- `src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx:21-33`
- `src/modules/BrowserAi/useCases/initBrowserAi.ts:33-58`

**Needed:** Move the catalogs/constants to `models/` (already
partially done in `ddspInstrumentCatalog.ts`). Both consumers
import from there. Delete duplicates.

### 18. Sub-folder barrels are AGENTS.md violations

**Problem:** `useCases/index.ts`, `stores/index.ts`,
`events/index.ts`, `presentations/views/index.ts` are all
sub-folder barrels. AGENTS.md "Do not add `index.ts` barrels …
**except** each module's **root** `index.ts`."

**Representative files:**

- `src/modules/BrowserAi/useCases/index.ts`
- `src/modules/BrowserAi/stores/index.ts`
- `src/modules/BrowserAi/events/index.ts`
- `src/modules/BrowserAi/presentations/views/index.ts`

**Needed:** Add a single root `index.ts` (issue #1). Inline all
four sub-folder barrels' exports into it. Delete the sub-folder
`index.ts`s. Update intra-module imports to relative paths to
specific files (already mostly correct).

### 19. AGENTS.md function signature violations

**Problem:** Functions with > 1 positional parameter, in
violation of "Functions with more than one parameter take a
single object param".

**Representative files:**

- `src/modules/BrowserAi/services/audioResampler.ts:46,58`
- `src/modules/BrowserAi/repositories/storageManager.ts:31`
- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts:101,127,161,173,337`
- `src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts:121-126`

**Needed:** Refactor each to accept a single
`<FunctionName>Input` object. Internal worker helpers can use
inline object types.

### 20. Type-soundness escapes (`as`, `as unknown as`, dead `?? 0`)

**Problem:** Multiple `as`/`as unknown as` casts that silence
the compiler instead of narrowing.

**Representative files:**

- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts:60-61,428`
- `src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts:189,197,204`
- `src/modules/BrowserAi/repositories/storageManager.ts:168,192-193`
- `src/modules/BrowserAi/repositories/capabilityDetector.ts:62-65`
- `src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx:267`
- `src/modules/BrowserAi/services/audioResampler.ts:62,64,83`

**Needed:** Type `OrtModule` to match
`onnxruntime-web`'s upstream module shape (or import its
`InferenceSession` types). Replace `response as Extract<...>`
with runtime narrowing on `response.type`. Remove
`audio.buffer.slice(0) as ArrayBuffer` — `slice` already
returns ArrayBuffer. Drop dead `audio[index] ?? 0` on typed
array reads with explicit bounds. Use `navigator.gpu` from
modern lib.dom.

### 21. Zero tests across the entire module

**Problem:** No `__tests__/`, no `*.spec.ts`. The most
accident-prone code (G2P rules, LRU eviction, worker lifecycle,
download retry, capability cache, envelope math, cache key
collisions) has zero behavioural coverage.

**Representative files:** all of `src/modules/BrowserAi/`.

**Needed:** Start with the highest-risk surfaces:
- `phonemizer.spec.ts` — G2P pinning test on a 200-word
  dictionary.
- `kokoroTokenizer.spec.ts` — truncation + unknown-phoneme
  warning.
- `inferenceWorkerBridge.spec.ts` — concurrent loadOnnxSession
  asserts only one worker is created (Promise-coalesce contract).
- `onnxInferenceWorker.spec.ts` — concurrent
  `run-diffsinger-phrase` messages serialise (issue #6).
- `modelDownloadManager.spec.ts` — retry honors AbortSignal;
  progress events throttled.
- `capabilityDetector.spec.ts` — schema-version invalidation;
  corrupt-JSON cleanup.

### 22. `extractFeatures`-style global mutation in `kokoroTokenizer` cache

**Problem:** `renderKokoroTts.voiceEmbeddingCache` is module-level
mutable `Map`, populated by network fetches that have no
Promise-coalesce. Two concurrent renders for the same voice both
hit the network.

**Representative files:**

- `src/modules/BrowserAi/useCases/renderKokoroTts.ts:37-71`

**Needed:** Convert to Promise-coalesce
(`Map<voiceId, Promise<Float32Array>>`). Persist to OPFS so the
fetch happens once across page loads, not once per page load.

### 23. Hot-loop allocations in download/render

**Problem:** Per-chunk `BroadcastChannel` creation
(`modelDownloadManager.ts:54-63`), 3× model-bytes peak heap
(`:108-115,158`), `writeModel.slice(0)` copy
(`storageManager.ts:120`), full-tree `modelRegistryStore` rebuild
on every patch (`stores/modelRegistryStore.ts:43-69`).

**Representative files:**

- `src/modules/BrowserAi/repositories/modelDownloadManager.ts:54-115`
- `src/modules/BrowserAi/repositories/storageManager.ts:118-125`
- `src/modules/BrowserAi/stores/modelRegistryStore.ts:34-71`

**Needed:** Hold one BroadcastChannel; stream to
`FileSystemWritableFileStream`; structural-sharing in
`updateModelStatus` (only rebuild the targeted voicebank's
sub-tree, not all voicebanks).

### 24. Unused services / dead code

**Problem:** `audioResampler.float32ToAudioBuffer`, `midiToHz`,
`velocityToDb` are referenced only by `services/midiToDdspInput.ts`,
which is unused while DDSP is stubbed (issue #2). They ship as
dead bytes.

**Representative files:**

- `src/modules/BrowserAi/services/audioResampler.ts:46-105`
- `src/modules/BrowserAi/services/midiToDdspInput.ts`

**Needed:** Either land DDSP support and make them live (issue
#2) or surface them for deletion in a follow-up.

### 25. `initBrowserAi` first-pass over MIDI marks every clip stale

**Problem:** `useCases/initBrowserAi.ts:133-155` initialises
`prevNotesByClipId = midiStore.value?.notesByClipId ?? {}` at
subscription time. If `MIDI` initialises after `BrowserAi` (or
hydrates async), the first subscription invocation compares `{}`
vs a populated map — every clip looks "changed" and every
already-rendered phrase is marked stale.

**Representative files:**

- `src/modules/BrowserAi/useCases/initBrowserAi.ts:130-155`

**Needed:** Either gate the subscription on `midiStore` being
hydrated, or only mark stale on _successive_ updates by
discarding the first emission.

### 26. `AiRenderClipPreview` leaks audio buffers into `audioBufferCache`

**Problem:** Every preview play allocates a new `AudioBuffer` and
inserts it into `audioBufferCache` (cross-module). No cleanup on
unmount or render-replacement. Across a session, the cache grows
unboundedly.

**Representative files:**

- `src/modules/BrowserAi/presentations/views/AiRenderClipPreview.tsx:28-49`

**Needed:** On unmount, `audioBufferCache.delete(bufferIdRef.current)`.
When the parent re-renders with a new `audio` prop, evict the
old buffer.

---

## Open questions

- [ ] Is DDSP intended to ship in this build? If yes, what is the
      Rolldown blocker (issue #2 cites it but nothing is on disk)?
      If no, the catalog should be hidden.
- [ ] Is per-request worker cancellation (issue #7) feasible without
      ONNX Runtime support for in-flight cancellation? (ORT does not
      expose a cancel API; the worker would need to abandon the
      session output.)
- [ ] What is the intended lifetime of `voiceEmbeddingCache` — page
      session or persistent? OPFS persistence (issue #22) is a
      ~10 MB cost.
- [ ] Should the capability detector's `WebGpuTier` thresholds be
      a real benchmark or a heuristic on `chromeVersion +
      hardwareConcurrency`? The current implementation is neither.
- [ ] What is the threat model for the `BroadcastChannel` (issue
      #84)? If cross-tab visibility of "user is downloading a model"
      is acceptable, document; otherwise switch to a same-tab
      `EventTarget`.

---

## Risks

- **Concurrent renders silently corrupt each other** (issue #6).
  A user clicking "render" on two phrases at once gets undefined
  results — the worker has no serialisation. As soon as the UI
  exposes parallel renders this is a guaranteed bug.
- **GPU memory accretion** (issues #8, #9). DiffSinger pipelines
  with no tensor disposal will eventually fail with WebGPU OOM
  in long sessions; the failure mode is opaque and the
  `1 GB / file-size` budget masks the real footprint.
- **OOM on weak devices during download** (issue #12). 3× peak
  heap for a 1 GB voicebank exceeds Chrome's per-tab heap budget
  on 4 GB devices; the download throws an opaque "out of memory"
  the retry loop dutifully repeats.
- **DDSP feature is fake** (issue #2). Users who download "DDSP
  Violin" and click "render" get an error. Trust damage is
  proportional to the prominence of the UI, which is high
  (model manager + clip inspector).
- **Cancellation kills unrelated renders** (issue #7).
  `terminateOnnxWorker` rejects every pending request; user A
  cancels phrase 1 and inadvertently kills phrase 2.
- **No tests** (issue #21). Every DSP/networking/lifecycle
  refactor lands blind. The G2P rule engine is one-of-a-kind in
  this codebase and a regression is undetectable without manual
  audition.
- **Architectural drift accumulates.** No root barrel, four
  sub-folder barrels, type-assertion escapes, positional args.
  Consumer modules already deep-path into BrowserAi; closing
  the barrier will require updating 4+ external import sites
  in lockstep with the new `index.ts`.

---

## Suggested approaches

- **Land the module barrel first** (issue #1). Mechanical;
  unlocks a `pnpm deps:validate` enforcement of cross-module
  boundaries and clarifies the public surface.
- **Decide DDSP's fate** (issue #2). Either bundle TF.js (find
  the actual blocker — Rolldown can be configured) or hide the
  feature. Shipping a fake feature is worse than shipping
  nothing.
- **Wire `AbortController` end-to-end** (issue #7). The dead
  field in `ActiveRender` makes it look like cancellation is
  cooperative; it isn't. Either remove the field or implement
  per-request `cancel-request` in the worker protocol and stop
  using worker termination as a cancellation primitive.
- **Serialise the worker** (issue #6). One Promise chain per
  worker, drained one message at a time. Document the
  invariant.
- **Promise-coalesce the lazy singletons** (issue #5). One
  pattern, three places.
- **OPFS streaming + measurement scoping** (issues #10–13).
  Stream downloads directly to OPFS; measure only `models/` and
  `renders/`; enforce LRU eviction.
- **Tensor disposal pass** (issue #8). Audit
  `runDiffSingerPipeline` and add `dispose()` calls. Add a
  memory-pressure test.
- **Test scaffolding** (issue #21). Six spec files would
  cover the highest-risk surfaces. Pin the G2P engine first;
  it has the most "works by accident" surface.

---

## Recommendation

Start with **issue #1 (root `index.ts`)** because it unblocks
`pnpm deps:validate` on the module and surfaces the cross-module
contract. Land it as a single commit alongside the four consumer
import-path updates.

Then tackle **issue #2 (DDSP fake-feature)** because it is the
single most user-visible problem — the model manager promises
something the worker explicitly disables. Either land DDSP for
real or hide it; shipping the current state is dishonest.

After those two, choose between:

- **Correctness pass** (issues #5, #6, #7, #8, #9, #11, #15) —
  worker concurrency, lazy-singleton races, tensor disposal,
  cancellation, eviction. The riskiest surfaces.
- **Architecture pass** (issues #18, #19, #20) — sub-folder
  barrels, positional args, `as` escapes. Mechanical sweeps.

These are independent. The correctness pass is more valuable but
also harder; the architecture pass is mechanical and unblocks
future audits from re-finding the same violations.

In parallel, **start the test scaffold** (issue #21) on the
G2P pinning test — that surface has the most "silent miscompile"
risk and costs ~200 lines of spec data.

---

## Resolved

_No issues resolved yet._
