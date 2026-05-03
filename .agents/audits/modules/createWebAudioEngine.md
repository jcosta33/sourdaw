# createWebAudioEngine audit

## Scope

This audit covers the `createAudioEngine` factory and `audioEngine` singleton
defined in `src/modules/AudioEngine/repositories/createWebAudioEngine.ts`,
its sole spec at `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts`,
and the public `AudioEngine` contract in
`src/modules/AudioEngine/models/AudioEngineState.ts` insofar as the
factory is responsible for satisfying it.

It explicitly excludes the contents of `engine/TrackNode.ts`, `engine/BusNode.ts`,
`engine/AdjustmentLayerRuntime.ts`, the worklet processor sources
themselves (`services/meteringProcessor.ts`, `services/recordingProcessor.ts`),
and the use-case wrappers that call into the singleton — those are covered
by the broader `.agents/audits/modules/AudioEngine.md`.

> **Note on the "module path".** The instruction referenced
> `src/modules/createWebAudioEngine/`, but that path on disk is a **0-byte
> file**, not a directory. The actual factory lives at
> `src/modules/AudioEngine/repositories/createWebAudioEngine.ts`. The
> 0-byte placeholder is itself an issue (see #25). This audit treats the
> repository file as the subject.

Related audit: `.agents/audits/modules/AudioEngine.md` (broader engine surface).
Related spec: none on disk.

It is an adversarial review: AudioContext lifecycle on user gesture,
worklet module loading races, init/dispose ordering, fallback-mode
correctness, SAB safety on cross-origin-isolated boundaries, AGENTS.md
violations, type soundness, and test coverage gaps.

---

## Goal

A correctness-first AudioContext factory:

- The `AudioContext` is **never created at module import time**. A user
  gesture (or explicit boot) must precede construction. Construction is
  guarded behind a factory call, not an eager `export const audioEngine
  = createAudioEngine()`.
- `initialize()` resolves only after **all** required AudioWorklet modules
  are loaded; until it resolves, no use case may call `addDeviceToStrip`,
  `ensureTrackStrip`, or any path that depends on a worklet existing.
- `loadWorklets()` is **idempotent and retryable** — a transient failure
  to fetch one of the five `.js`/`.ts?worker&url` modules must not poison
  the engine forever.
- Failures during construction (`new AudioContext()` throws under
  Safari Lockdown / iframe sandbox / OS audio device unavailable) fall
  through to a real, observable noop graph that does not pretend to be
  ready.
- `dispose()` releases **everything**: worklet ports, scheduled nodes,
  pending device promises, the AudioContext itself, the
  `AdjustmentLayerRuntime`, and any internal Maps. After `dispose`,
  re-`initialize` either reboots cleanly or refuses with a clear error.
- The transport `SharedArrayBuffer` is allocated only when the
  cross-origin isolation environment supports it; otherwise the engine
  uses a plain `ArrayBuffer` shim or surfaces a hard error to the caller.
  Reads/writes across threads use `Atomics` to avoid torn-read hazards.
- The `AudioEngine` interface and its implementation match — no methods
  declared on the impl that aren't on the contract, no methods declared
  optional on the contract that the impl actually requires.
- The factory file is one repository function (`createAudioEngine`)
  per AGENTS.md "One Function Per File"; the singleton lives separately.
- Tests cover every public method, the fallback path, the worklet
  failure path, and `dispose` cleanup — without `as any` escapes.

---

## Relevant code paths

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts`
- `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts`
- `src/modules/AudioEngine/models/AudioEngineState.ts` (the `AudioEngine` contract)
- `src/modules/AudioEngine/useCases/initializeAudioEngine.ts`
- `src/modules/AudioEngine/useCases/engineAccess/resumeEngine.ts`
- `src/modules/Workspace/presentations/hooks/useAppInitialization.ts` (caller)
- `src/modules/Workspace/presentations/views/AudioResumeOverlay.tsx` (gesture path)
- `src/modules/createWebAudioEngine` — **0-byte file** sitting at
  `src/modules/createWebAudioEngine` (no extension, not a directory).

---

## Current behavior

**Eager singleton at module import.** The file ends with
`export const audioEngine = createAudioEngine()` (`createWebAudioEngine.ts:600`).
Importing _anything_ from this module — including in tests, in cross-module
use cases, in HMR reloads — instantiates a real `new AudioContext({
latencyHint: 'interactive' })` immediately. This runs before any user
gesture, before the page has even mounted, in every test that touches the
audio engine surface (directly or transitively).

**`AudioContext` constructor in a try/catch with a no-op fallback.** The
constructor (`:51-71`) wraps the real-context path in `try`. On failure
it logs, calls `notifyUser`, sets `fallbackMode = true`, and runs
`setupNoopContext()` which creates an `OfflineAudioContext(2, 1, 44100)`
double-cast to `AudioContext`. The fallback context is then handed to
`createAdjustmentLayerRuntime` unconditionally (`:73-78`), even when the
context is actually offline.

**Worklet loading.** `initialize()` (`:94-97`) lazily creates an
`initPromise` that resolves `loadWorklets()`. `loadWorklets` does
`Promise.all([...5 addModule calls...])` and sets `workletReady = true`
on success. There is no failure handling: a single rejected `addModule`
causes the entire `Promise.all` to reject, leaving `initPromise` as a
permanently-rejected promise. Subsequent `initialize()` calls return the
same rejection. There is no retry, no per-module error reporting, no
fallback mode triggered by worklet failure.

**Three of the five worklet URLs are absolute paths to compiled JS in
the public dir** (`/audio/worklets/sidechain-compressor-processor.js`,
etc.); two are Vite-specific TS imports
(`recordingProcessor.ts?worker&url`, `meteringProcessor.ts?worker&url`).
The mix of conventions means the test environment cannot resolve either
path the same way production does.

**`masterMeterNode` is declared but never wired.** Line 29 declares
`public masterMeterNode!: AudioWorkletNode | NoopMeterNode`. The fallback
branch (`:85-89`) assigns a NoopMeterNode. The non-fallback branch
**never assigns `masterMeterNode`** — it stays `undefined` forever (the
`!` non-null assertion makes TypeScript believe otherwise). Yet
`getMasterPeakLevel()` (`:232-239`) reads `masterMeterBuffer[0]` and
zeros it, expecting a meter worklet to have written to it via SAB or a
similar shared mechanism — which never happens.

**`getMasterPeakLevel` always returns 0 in production.** Because no
worklet writes to `masterMeterBuffer`, the read at `:236` is always `0`.
The non-null assertion `masterMeterBuffer[0]!` exists purely to satisfy
the TS strict index signature. Effectively dead code masquerading as a
working API.

**Transport SAB.** The constructor unconditionally allocates
`new SharedArrayBuffer(64)` (`:48`) and a `Float64Array` view over it
(`:49`). On a page that lacks Cross-Origin-Opener-Policy /
Cross-Origin-Embedder-Policy headers, `SharedArrayBuffer` is undefined
and this throws **before** the try/catch block on `:51`. The fallback
path is unreachable in that case — the entire module import fails. The
test file works around this by injecting
`(global as any).SharedArrayBuffer = class extends ArrayBuffer {}`
(`__tests__/createWebAudioEngine.spec.ts:54`).

**`setTransportInfo` writes 7 fields non-atomically** (`:362-370`).
A worklet on the audio thread reading via the same SAB can observe
torn writes (e.g. `currentBeat` updated, `tempo` not yet). No
`Atomics.store` / sequence-lock pattern is used. The 64-byte SAB layout
is documented only in a constructor comment (`:46-47`); no offset
constants exist.

**`dispose()`** (`:588-593`) tears down the per-project graph
(`resetGraph`), disconnects master gain and analyser, and calls
`void this.context.close()` — promise dropped, no error handling, no
clearing of `initPromise`, no clearing of `transportSAB` /
`transportView`, no notification to the AdjustmentLayerRuntime. After
`dispose()`, the next call to `initialize()` returns the cached
(possibly-rejected) `initPromise` and the engine is unusable.

**`removeTrackStrip` does not clean cross-references.** A track may be
the source of `sendNodes` and `sidechainConnections`. `removeTrackStrip`
calls `node.dispose()` and removes the entry from `trackNodes`
(`:203-209`), but the lingering `SendNode.gainNode` and sidechain
`scGain` still hold connections from the now-disposed strip's analyser
node. No symmetric cleanup happens. Compare with `removeBusStrip`
(`:250-263`) which **does** sweep dependent sends.

**`waitForDevices` busy-loop.** `:425-435` awaits `Promise.all(...)`,
checks the deadline, and re-enters if `pendingDevicePromises.size > 0`.
The check happens once per outer iteration, so a flood of device-add
calls during the await can extend the loop arbitrarily until the
deadline trip. There's no cleanup of rejected device promises — a
permanently-rejecting promise would keep the size > 0 forever.

**`AudioEngine` interface and impl drift.**

- `AudioEngine.context` is declared `readonly`
  (`models/AudioEngineState.ts:150`) but the impl declares
  `public context!: AudioContext` and reassigns it inside
  `setupNoopContext()` (`createWebAudioEngine.ts:82`).
- `setMasterTrackId?(trackId: string)` is declared on the interface
  (`AudioEngineState.ts:196`) but **never implemented** on the impl.
- `getTransportSAB(): SharedArrayBuffer` is implemented on the impl
  (`createWebAudioEngine.ts:372-374`) but **not declared** on the
  interface.
- `applyAdjustmentLayerTick`, `resetAdjustmentLayers`, and
  `listLiveAdjustmentBusKeys` are optional on the interface
  (`AudioEngineState.ts:205-207`) but unconditionally implemented.

**Test coverage.** The single spec file has 5 tests, all on the happy
path: `should initialize with master nodes`, `should load worklets on
initialize`, `should manage master gain`, `should ensure and remove
track strips`, `should handle master peak level`. There are no tests
for: `resume`, `suspend`, `setTrackPan`, `setTrackMute`, `setSend` /
`removeSend`, `wireSidechainRoute` / `unwireSidechainRoute`,
`setTransportInfo`, `getTransportSAB`, `dispose`, `resetGraph`,
fallback mode (constructor exception), `loadWorklets` failure, or any
of the device-routing methods. Tests use `engine: any`, `mockCtx: any`,
and `(global as any).…` repeatedly.

---

## Findings

1. **The file ships an eagerly-instantiated singleton.** Every test, every
   HMR cycle, every code path that touches `AudioEngine` boots a real
   AudioContext at module-import time, decoupled from any user gesture.
   This is the root of half of the problems below — fallback mode
   confusion, SAB-undefined crashes, test brittleness, and the
   `AudioWorkletNode` polyfill the test file installs to keep the import
   alive.

2. **The factory file violates "One Function Per File."** AGENTS.md
   states repositories must export exactly one function. This file
   exports `createAudioEngine` (factory) **and** `audioEngine`
   (singleton). The singleton's existence is the source of the eager-init
   problem; even if it must exist, it belongs in a separate file.

3. **Fallback mode is half-built.** `setupNoopContext` rebuilds the
   master chain on an `OfflineAudioContext` cast through `BaseAudioContext`
   to `AudioContext`. The `AdjustmentLayerRuntime` is then constructed
   pointing at this offline context. Most public methods short-circuit
   on `this.fallbackMode`, but several do not (`addDeviceToStrip`,
   `updateDeviceParam`, `ensureTrackStrip`'s fallback branch, etc.) —
   they will run on the offline context and either silently no-op or
   throw when they try to use APIs the offline context doesn't support
   (e.g. `AudioWorkletNode` construction).

4. **Worklet load failure is permanent.** `loadWorklets()` rejects on
   any single failed `addModule`. `initialize()` caches the rejected
   promise. Subsequent `initialize()` calls return the same rejection.
   No retry, no per-module reporting, no fallback. A transient
   network blip or one stale URL kills the engine for the lifetime of
   the page.

5. **`masterMeterNode` is dead.** Declared at `:29`, referenced only in
   the noop fallback path. The non-fallback path never assigns it. The
   five worklet modules loaded by `loadWorklets` include
   `meteringProcessor` but no master-level instance is ever created.
   `getMasterPeakLevel()` always returns 0 in production. Either the
   metering wiring was never finished or it lives elsewhere and this
   field/method should be deleted.

6. **`SharedArrayBuffer` unguarded module-level allocation.** Without
   COOP/COEP, `SharedArrayBuffer` is undefined; `new SharedArrayBuffer(64)`
   throws `ReferenceError` at constructor time, before the try/catch
   for `AudioContext`. Outcome: a single missing header on the host
   page → entire AudioEngine module fails to import → every
   `executeAppAction` that depends on it dies. Test workaround
   confirms the hazard (`createWebAudioEngine.spec.ts:54`).

7. **Transport SAB writes are non-atomic.** `setTransportInfo` writes
   seven `Float64Array` cells in sequence. A worklet reading on the
   audio thread can observe a half-updated state (e.g. new beat, old
   tempo). No sequence-lock, no `Atomics.store`. Audio-thread rules
   demand torn-write safety.

8. **Interface ↔ impl drift.** `setMasterTrackId` declared on interface,
   not implemented; `getTransportSAB` implemented, not declared;
   `context` declared `readonly` but reassigned in fallback;
   `applyAdjustmentLayerTick` & friends declared optional but always
   present. Each row is either a missing feature or a misleading
   contract.

9. **`removeTrackStrip` leaks dependent sends and sidechain routes.**
   The track's analyser node is disposed but the `SendNode.gainNode`
   and sidechain `scGain` keep their input connections. No symmetric
   sweep matches `removeBusStrip`'s send sweep.

10. **`dispose()` is incomplete.** Drops the close-promise, doesn't
    reset `initPromise`, doesn't release `transportSAB`/`transportView`,
    doesn't tear down the AdjustmentLayerRuntime, doesn't clear
    `pendingDevicePromises`. Re-initialise after dispose returns the
    stale (possibly rejected) `initPromise`.

11. **Mute API third parameter is dead.** `setTrackMute(trackId, muted,
_restoreGain?)` — `_restoreGain` is named with a leading underscore
    (signal: unused) and never forwarded to `TrackNode.setMute`. It
    exists on the public interface
    (`AudioEngineState.ts:166: setTrackMute(trackId, muted, restoreGain?)`)
    but the impl ignores it. Either remove or implement.

12. **`getMasterGain` returns the wrong value during ramps.** Reads
    `gainNode.gain.value` directly. Since `setMasterGain` uses
    `setTargetAtTime`, `value` lags the target. The test
    (`createWebAudioEngine.spec.ts:76-77`) papers over this by manually
    mutating `gain.value`. Real callers see stale data.

13. **`setSend` mixes write strategies.** `setSend` updates an existing
    send via `setTargetAtTime` (`:389`) but creates a new send via
    direct `gain.value = level` (`:405`). Inconsistent ramp behaviour:
    the first write to a send is instant; subsequent writes are smoothed.
    This causes audible discontinuities the first time a send is created
    while audio is playing.

14. **AGENTS.md function-signature rule violated extensively.** Most
    public methods take 3+ positional parameters. AGENTS.md mandates a
    single object param when there is more than one parameter. Examples:
    `setTrackMute(trackId, muted, restoreGain?)`,
    `addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId?)`,
    `setSend(sourceTrackId, busId, level, preFader)`,
    `setTransportInfo(beat, tempo, isPlaying, loopStart, loopEnd, isLooping)`,
    `wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId)`,
    `scheduleOscillator(frequency, startTime, duration, gain)`,
    `scheduleClick(time, accent, volume)`, every `scheduleDeviceKey*`,
    every `updateDevice*`, every `updateMidiFx*`. The interface in
    `AudioEngineState.ts` mirrors all of these.

15. **Type-soundness escapes.** The implementation uses
    `OfflineAudioContext as BaseAudioContext as AudioContext`
    (`createWebAudioEngine.ts:82`) — exactly the `as X as Y` pattern
    AGENTS.md "TypeScript — soundness" forbids. The test file uses
    `engine: any`, `mockCtx: any`, `(global as any).AudioWorkletNode`,
    `(global as any).SharedArrayBuffer` (`:42-54`).

16. **`fallbackMode` ad-hoc dispatch.** Twelve methods short-circuit on
    `this.fallbackMode` with copy-pasted `if (this.fallbackMode) return;`
    or `return 0`/`return undefined`. The pattern indicates two engines
    coexisting in one class. A `class FallbackAudioEngine implements
AudioEngine` with appropriate stubs would isolate the two.

17. **`scheduleOscillator` no-ops in fallback** but `scheduleClick`
    (which calls `scheduleOscillator`) does not check `fallbackMode`
    before computing frequencies (`:498-503`). Harmless because the
    inner function bails, but a callsite reading the impl is confused.

18. **`setupNoopContext` does not connect master analyser to
    destination** (`:90-91`) — only `masterAnalyser` is created; no
    `masterAnalyser.connect(this.context.destination)`. In the real
    path this happens at `:61`. Fallback is silent (correct) but the
    asymmetry signals incomplete fallback wiring.

19. **`removeBusStrip` mutates the same Map it iterates** (`:255-260`).
    `for…of this.sendNodes` then `this.sendNodes.delete(key)` inside the
    loop. JS `Map.prototype.delete` during iteration is well-defined,
    but it's a smell and the same pattern in `removeTrackStrip` is
    absent (issue #9).

20. **`stopAllScheduled` fan-out is O(tracks × 128 × deviceNodes)**
    (`:519-543`). For each track strip and each device on it, it
    iterates 0–127 (notes) or 0–15 (toaster pads) calling `noteOff`.
    On a project with 30 tracks × 8 devices, that's
    30×8×128 = 30 720 `noteOff` calls per `stopAllScheduled`. Every
    `noteOff` posts a message to the worklet port. The Levain
    `allNotesOff` short-circuit (`:539`) was added precisely to avoid
    this fan-out for that one device, with a prose comment pointing to
    a bug doc. Fermenter and Toaster still pay the cost.

21. **`scheduledNodes` cleanup races.** Each `scheduleOscillator` (`:489`)
    sets an `onended` handler that splices the node out of the array.
    If `stopAllScheduled` runs first, it sets `scheduledNodes.length = 0`
    (`:517`); the not-yet-fired `onended` then calls `splice` on an empty
    array (no-op), but the `env.disconnect()` may already have been
    disconnected by GC. Not a correctness bug, but the pattern is fragile.

22. **`pendingDevicePromises` never sees rejections.** `waitForDevices`
    (`:425-435`) `await Promise.all(...)` will reject and unwind the
    loop; the rejected promises stay in the Set. The `clear()` call
    only fires on the timeout branch. A single failing device blocks
    `waitForDevices` until the deadline.

23. **No retry / health surface.** There is no `getEngineHealth()` or
    `lastInitError` accessor. UI can only ask `getState().isReady`,
    which conflates "context is running" with "worklets loaded". A
    user who clicks the resume overlay after a worklet failure gets
    silent failure.

24. **Vite-specific worklet imports leak into tests.**
    `import meteringProcessorUrl from '../services/meteringProcessor.ts?worker&url'`
    (`:7-8`) is a Vite plugin syntax. The single spec file does not
    mock the import; under Vitest's default resolver the URL string
    is whatever Vitest decides to do with the unknown query string.
    Tests pass only because `addModule` is mocked at the
    `audioWorklet` level — the path string is never inspected. Any
    test that does inspect it would break.

25. **`src/modules/createWebAudioEngine` is a 0-byte placeholder file.**
    `ls -la /Users/josecosta/dev/webdaw/src/modules/createWebAudioEngine`
    shows a 0-byte regular file at module level. It is not imported
    anywhere (search returns nothing). Remnant of an aborted refactor
    — and it implies someone intended to extract the factory to its
    own module folder. Either delete the placeholder or finish the move.

26. **Initialise/resume contract is unclear.** `initializeAudioEngine`
    (`useCases/initializeAudioEngine.ts:11-19`) awaits `initialize()`
    then calls `registerBuiltinPlugins`/`registerBuiltinFaustDSP` which
    presumably register modules with the `audioWorklet`. But
    `initialize()` already loaded five hard-coded worklets. There is no
    barrier between "core worklets loaded" and "plugin worklets
    loaded"; callers cannot tell whether a `executeAppAction({ type:
'addDevice' …})` will succeed.

27. **`resume()` swallows errors silently.** `:114-120` logs at warn
    level on resume failure but does not surface it. The
    `AudioResumeOverlay` (`Workspace/presentations/views/AudioResumeOverlay.tsx`)
    will dismiss on `void resumeEngine()` and the user moves on with a
    suspended context they cannot tell is suspended.

28. **No test for the constructor's catch path.** Issue #3's complexity
    has zero coverage. The `notifyUser` mock is set up
    (`createWebAudioEngine.spec.ts:37-39`) but no test triggers it.

29. **No test for `dispose`, `resetGraph`, `setTransportInfo`,
    `getTransportSAB`, sends, sidechain, mute, pan.** The five tests
    cover constructor, worklet load count, gain getter/setter, strip
    add/remove, peak getter — about 15% of the public surface. Many of
    the riskiest methods (sends, sidechain, transport SAB) ship
    without tests.

30. **Mock infrastructure assumes a `mockCtx` shape that drifts from
    `AudioContext`.** `createMockAudioContext` (in
    `helpers/__tests__/audioContext.mock.ts`) is consumed via `mockCtx:
any`. Any type drift in the real `AudioContext` API (or in the impl's
    use of it) is silently absorbed.

31. **`adjustmentRuntime` is not nullable on the impl** (`:43`) but is
    constructed unconditionally in the constructor (`:73-78`) — even in
    fallback mode where it's pointed at an offline context. If
    `setupNoopContext` is invoked, `getContext: () => this.context`
    returns the offline context; the runtime then issues `connect`
    calls that may or may not be valid on offline contexts.

32. **No `cleanup` for `AudioWorkletNode` ports on dispose.** Each
    `addModule` registers a processor; the impl never instantiates
    `AudioWorkletNode` at master level (issue #5), but
    `TrackNode`/`BusNode` do. `dispose()` calls `resetGraph` which
    calls `removeTrackStrip` (which calls `TrackNode.dispose`), so
    those nodes _should_ get cleaned up — but no port-level
    `postMessage({ type: 'shutdown' })` is sent. If processors hold
    long-lived buffers (typical for sampler/synth worklets), GC alone
    is not enough.

33. **`workletReady = true` is set even if the engine is in fallback
    mode** — wait, no: `initialize()` short-circuits on fallback
    (`:95`). Correct. But `getState().isReady` returns `state ===
'running' || workletReady` (`:162`). `state === 'running'` can be
    true on the offline context. So `isReady` can return true in
    fallback mode (when offline context starts in `'suspended'` and
    later 'closed'). Verify and document.

34. **No teardown for `transportSAB` consumers.** `getTransportSAB()`
    hands the SAB to other modules; on dispose the SAB lingers. If a
    worklet still holds a reference, it may keep firing reads against
    a logically-dead engine.

---

## Priorities

1. **Eager singleton + module-level SAB allocation** (issues #1, #2, #6)
   — the file imports a live AudioContext and a `SharedArrayBuffer`
   before any user gesture, before any feature-detection. This is the
   single most likely cause of cross-environment failures (Safari, COOP/
   COEP-less hosting, server-side rendering).
2. **Worklet load failure is permanent** (issue #4) — one transient 404
   kills the engine for the rest of the session.
3. **`getMasterPeakLevel` is dead, `masterMeterNode` is never wired**
   (issue #5) — a public method that always returns 0 is worse than a
   missing method.
4. **Transport SAB non-atomic writes** (issue #7) — torn reads on the
   audio thread are an audio-thread-rule violation
   (AGENTS.md "audio thread must never allocate, lock mutexes, or
   block" — implies torn reads are unacceptable).
5. **Interface ↔ impl drift** (issue #8) — the public contract lies
   about what the engine offers; callers either rely on missing methods
   or duplicate the optional checks.
6. **`dispose` and `removeTrackStrip` leaks** (issues #9, #10) — engine
   teardown is incomplete, leaving send/sidechain refs dangling on
   disposed nodes.
7. **Fallback mode is half-built** (issues #3, #16, #18, #31) — a
   `FallbackAudioEngine` would isolate the two code paths.
8. **AGENTS.md compliance: positional args, type-soundness escapes,
   test `as any`** (issues #2, #14, #15, #28-#30) — broad-but-mechanical
   sweep.

---

## Open issues

### 1. Eager `audioEngine` singleton at module import

**Problem:** `export const audioEngine = createAudioEngine()`
(`createWebAudioEngine.ts:600`) instantiates `new AudioContext({
latencyHint: 'interactive' })` and `new SharedArrayBuffer(64)` at
module-import time. Any test, any HMR reload, any cross-module use
case that pulls in AudioEngine boots a real audio context. Browsers
emit autoplay-policy warnings for non-gesture-bound contexts; SSR
crashes; tests pollute each other; HMR leaks contexts.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:600`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:48`
- `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts:49-54`

**Needed:** Move the singleton to a separate file (e.g.
`engineSingleton.ts`) that lazy-instantiates on first access, gated
on `typeof window !== 'undefined'` and (for SAB) the
`crossOriginIsolated` flag. Or accept that the singleton must exist
but defer construction until `initializeAudioEngine()` is called by
the bootstrap. Either way, get rid of the side-effecting top-level
`createAudioEngine()` call.

### 2. File exports two values; AGENTS.md "One Function Per File"

**Problem:** Repositories must export exactly one function (AGENTS.md
"One Function Per File"). This file exports `createAudioEngine`
(factory) and `audioEngine` (singleton instance).

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:596,600`

**Needed:** Split the singleton into its own file. The factory stays
as the sole export of `createWebAudioEngine.ts`.

### 3. Fallback mode is half-built

**Problem:** When `new AudioContext()` throws, the impl flips
`fallbackMode = true` and constructs an `OfflineAudioContext`
double-cast to `AudioContext`. The `AdjustmentLayerRuntime` is then
constructed pointing at the offline context. Twelve methods
short-circuit on `fallbackMode` but several (`addDeviceToStrip`,
`updateDeviceParam`, `updateDevicePatch`, `scheduleDeviceKey*`) do
not — they will run on the offline context and either silently no-op
or throw on `AudioWorkletNode` construction (offline contexts in some
browsers don't support worklets). `setupNoopContext` doesn't connect
master analyser to destination either.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:63-92`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:73-78`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:273-343`

**Needed:** Either (a) define a `FallbackAudioEngine implements
AudioEngine` class that returns sensible no-ops for every method and
swap to it when the real `AudioContext` fails, or (b) audit every
public method and add the `fallbackMode` early-return. Option (a)
removes the duplication and matches the "two engines coexisting"
shape.

### 4. Worklet load failure is permanent

**Problem:** `loadWorklets()` does `Promise.all([...5 addModule...])`.
A single rejected `addModule` rejects the whole promise. `initPromise`
is set to that rejected promise (`:95`) and remains so for the
lifetime of the engine. There is no retry, no per-module reporting,
no fallback toggle, no health surface. A transient 404 or stale URL
kills the engine.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:94-108`

**Needed:** Use `Promise.allSettled` and inspect each result. On
failure: retry with backoff (or report each per-module error to a
health store), and decide whether to flip `fallbackMode` or surface a
recoverable error. Reset `initPromise` to `null` on failure so a
later `initialize()` can retry. Add a test that mocks one
`addModule` to reject.

### 5. `masterMeterNode` is dead; `getMasterPeakLevel` always returns 0

**Problem:** `masterMeterNode` is declared (`:29`) but never assigned
in the non-fallback path — only in `setupNoopContext`. The five
worklet modules loaded by `loadWorklets` include `meteringProcessor`,
but no master-level instance is ever created. `masterMeterBuffer` is
allocated (`:62`) but no worklet writes to it. `getMasterPeakLevel`
reads `masterMeterBuffer[0]!` and zeros it; the read is always 0.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:29,36,62,99-108,232-239`

**Needed:** Either wire a real master `AudioWorkletNode('metering-processor')`
into the master chain after `loadWorklets` completes, posting
peak-level updates back via `port.onmessage` into `masterMeterBuffer`,
or delete the `masterMeterNode`/`getMasterPeakLevel` API and switch
master-meter consumers to read `masterAnalyser.getFloatTimeDomainData`
directly. Add a test that asserts a non-zero peak after a known
signal.

### 6. `SharedArrayBuffer` unguarded module-level allocation

**Problem:** Constructor (`:48`) does
`this.transportSAB = new SharedArrayBuffer(64)`. On any host page
without COOP/COEP, `SharedArrayBuffer` is undefined and this throws
`ReferenceError` _before_ the `try` block at `:51`. The module-level
singleton (`:600`) propagates the throw upward — every importer sees a
module-load failure. Test file confirms by polyfilling at
`createWebAudioEngine.spec.ts:54`.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:48-49`

**Needed:** Move SAB allocation inside the try/catch (so a missing
SAB triggers `fallbackMode`), or feature-detect at the top of the
constructor and use a plain `ArrayBuffer` shim for environments
without isolation. Surface a clear error if isolation is required for
production but absent.

### 7. Transport SAB writes are non-atomic

**Problem:** `setTransportInfo` (`:354-370`) writes seven cells of
the `Float64Array` view in sequence, on the main thread. A worklet
on the audio thread reading the same SAB can observe a half-updated
state (e.g. new beat with old tempo). Audio-thread rules forbid
torn reads.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:46-49,354-370`

**Needed:** Adopt a sequence-lock pattern (`Atomics.store(seq, n,
seq[n] + 1)` before write, again after; reader retries on odd seq) or
pack all seven values into a single 8-byte slot encoded as a struct
and use `Atomics.store` on a `BigInt64Array`. Document the layout via
named constants instead of a constructor comment. Add a test that
runs a worker thread reading the SAB while the main thread writes and
asserts no torn states.

### 8. Interface ↔ impl drift

**Problem:** Multiple mismatches between the `AudioEngine` interface
in `models/AudioEngineState.ts` and `AudioEngineImpl`:

- `context` declared `readonly`; impl reassigns in fallback
  (`createWebAudioEngine.ts:82`).
- `setMasterTrackId?(trackId: string)` on interface; never implemented.
- `getTransportSAB(): SharedArrayBuffer` implemented; not on interface.
- `applyAdjustmentLayerTick`, `resetAdjustmentLayers`,
  `listLiveAdjustmentBusKeys` declared optional; always implemented.

**Representative files:**

- `src/modules/AudioEngine/models/AudioEngineState.ts:149-208`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:25-29,82,372,576-586`

**Needed:** Reconcile interface and impl. Drop unused declarations
(`setMasterTrackId`), promote always-present optionals to required,
remove `readonly` if it's a lie (or stop reassigning `context`). Add
`getTransportSAB` to the interface. Add a typecheck spec that
asserts `AudioEngineImpl` exhausts `AudioEngine`.

### 9. `removeTrackStrip` leaks dependent sends and sidechain routes

**Problem:** A track may be the source of `sendNodes`
(`{ sourceTrackId, busId, gainNode, preFader }`) and
`sidechainConnections` (keyed `${sourceTrackId}→${targetDeviceId}`).
`removeTrackStrip` (`:203-209`) calls `node.dispose()` and removes
the entry from `trackNodes`, but the lingering `sendNode.gainNode`
and sidechain `scGain` keep references back to the disposed
strip's analyser node. Compare with `removeBusStrip` which sweeps
dependent sends.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:203-209,250-263,437-471`

**Needed:** Mirror the bus-strip cleanup. Iterate `sendNodes`, drop
all where `sourceTrackId === trackId`. Iterate `sidechainConnections`,
drop all where the key starts with `${trackId}→`. Add a regression
test.

### 10. `dispose()` is incomplete

**Problem:** `dispose()` (`:588-593`) calls `resetGraph()`,
disconnects master gain and analyser, and calls
`void this.context.close()`. It does not: clear `initPromise`,
release `transportSAB`/`transportView`, reset `workletReady`,
release the `AdjustmentLayerRuntime`, clear
`pendingDevicePromises`, or await `context.close()`.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:588-593`

**Needed:** Make `dispose()` async and await `context.close()`.
Reset `initPromise = null`, `workletReady = false`,
`pendingDevicePromises.clear()`. Tear down `adjustmentRuntime`
(needs a `dispose` method on it). Document that the engine cannot be
re-`initialize`d after `dispose()` (or implement reboot). Add a
test.

### 11. Mute API third parameter is dead

**Problem:** `setTrackMute(trackId, muted, _restoreGain?)` —
`_restoreGain` named with a leading underscore (signal: unused) and
not forwarded to `TrackNode.setMute`. Yet it's on the public
interface (`AudioEngineState.ts:166`).

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:223-226`
- `src/modules/AudioEngine/models/AudioEngineState.ts:166`

**Needed:** Either implement `restoreGain` (capture pre-mute gain and
restore on unmute) or remove from both interface and impl.

### 12. `getMasterGain` returns stale value during ramps

**Problem:** Reads `gain.value` directly. Since `setMasterGain` uses
`setTargetAtTime` (`:140`), `value` follows an exponential approach
and lags the target. The test
(`createWebAudioEngine.spec.ts:76-77`) papers over by manually
mutating `gain.value`. Real callers see stale data; UI sliders may
oscillate.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:136-148`

**Needed:** Track the most recently requested target as a private
field and return that from `getMasterGain`. Or document the lag and
expose `getMasterTargetGain` separately.

### 13. `setSend` mixes write strategies (instant first write, ramped subsequent)

**Problem:** `setSend` updates an existing send via
`setTargetAtTime` (`:389`); creates a new send via direct
`gain.value = level` (`:405`). First write to a send is instant and
audible; subsequent are smoothed. Inconsistent UX.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:376-410`

**Needed:** Use `setTargetAtTime` for both. Initialize the new send
with `gain.value = 0` and ramp to `level`.

### 14. AGENTS.md function-signature rule violated extensively

**Problem:** AGENTS.md "Functions with more than one parameter take a
single object param." Most public methods on the engine take 3+
positional parameters. Examples (interface line; impl line):

- `setTrackMute(trackId, muted, restoreGain?)` — interface 166, impl 223
- `addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId?)` — 170, 273
- `setSend(sourceTrackId, busId, level, preFader?)` — 187, 376
- `setTransportInfo(beat, bpm, playing, loopStart?, loopEnd?, isLooping?)` — 197-204, 354-361
- `wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId)` — 193, 437
- `scheduleOscillator(frequency, startTime, duration, gain?)` — 190, 473
- `scheduleClick(time, accent, volume?)` — 191, 498
- `scheduleDeviceKeyOn`/`Off`(trackId, deviceId, pitch, velocity, time?) — 175-176, 294-312
- `updateDeviceParam`/`Patch`/`Bypass` — 172-173, 282-316

**Representative files:**

- `src/modules/AudioEngine/models/AudioEngineState.ts:166-204`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:215-322,354-470,473-503`

**Needed:** Refactor every multi-parameter method to take a single
object param. Mostly mechanical but cross-module — every callsite
in `useCases/`, `handlers/`, presentations breaks. Land as one
focused commit per method group (track strip, bus, send, transport,
schedule).

### 15. Type-soundness escapes

**Problem:** AGENTS.md "TypeScript — soundness" forbids `as X as Y`
double-casts. The impl uses
`new OfflineAudioContext(2, 1, 44100) as BaseAudioContext as AudioContext`
(`:82`). The test file uses `engine: any`, `mockCtx: any`,
`(global as any).AudioWorkletNode`, `(global as any).SharedArrayBuffer`.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:82`
- `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts:42-54`

**Needed:** Define a `FallbackAudioEngine` (issue #3) so the offline
context never has to be cast to `AudioContext`. In the spec, type
`engine` as the impl's return type; type `mockCtx` as the
`createMockAudioContext` return type; install
`AudioWorkletNode`/`SharedArrayBuffer` on `globalThis` with proper
typings (a `setup.ts` Vitest setup file).

### 16. `fallbackMode` ad-hoc dispatch across 12 methods

**Problem:** Twelve public methods short-circuit on `fallbackMode`
with copy-pasted `if (this.fallbackMode) return;`. Pattern indicates
two engines fighting for the same class. A `FallbackAudioEngine` is
the natural decomposition.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:111,123,137,143,151,232,345,377,438,473,506`

**Needed:** Split into `class WebAudioEngineImpl` (real) and
`class FallbackAudioEngine` (no-op). Factory returns one or the
other based on whether the AudioContext constructor succeeded.
Removes the `setupNoopContext` indirection entirely.

### 17. `setupNoopContext` does not connect master analyser to destination

**Problem:** Real path connects `masterAnalyser` to
`context.destination` (`:61`); fallback path does not (`:90-91`).
Asymmetry signals incomplete fallback wiring even though the
fallback is intentionally silent.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:81-92`

**Needed:** Either drop the `masterAnalyser.connect(...destination)`
in the real path (the silent offline context never plays) and rely on
the analyser tap regardless, or add the same connect in the fallback
path for symmetry. Better: collapse this into the
`FallbackAudioEngine` (issue #16).

### 18. `removeBusStrip` mutates Map during iteration (smell)

**Problem:** `for (const [key, send] of this.sendNodes) { …
this.sendNodes.delete(key); }` (`:255-260`). JS Map mutation during
iteration is well-defined but error-prone, and the same pattern is
absent in `removeTrackStrip` (issue #9).

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:250-263`

**Needed:** Collect keys first, then delete:
`const keys = [...]; for (const k of keys) this.sendNodes.delete(k)`.
Apply consistently in `removeTrackStrip`.

### 19. `stopAllScheduled` fan-out is O(tracks × 128) noteOff calls

**Problem:** For each track strip and each device on it, iterates
0–127 (Fermenter) and 0–15 (Toaster) calling `noteOff`. On a
project with 30 tracks × 8 devices, that's 30 720 noteOff messages
posted to worklet ports per stop. The Levain branch has a special
`allNotesOff` short-circuit because the fan-out caused an audible
release-noise stack (`:531-541` references the bug doc).

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:519-543`

**Needed:** Add `allNotesOff` to the `Fermenter`/`Toaster` controller
contracts and use it the same way Levain does. One `postMessage` per
device instead of 128.

### 20. `pendingDevicePromises` never sees rejections

**Problem:** A device that fails to load with a permanently rejected
promise stays in the Set. `waitForDevices` `await Promise.all(...)`
unwinds the loop on the first rejection; the rejected promises are
never removed from the Set. The `clear()` only fires on the timeout
branch.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:425-435`

**Needed:** Either wrap each promise in `.catch(() =>
this.pendingDevicePromises.delete(p))` at insertion time, or use
`Promise.allSettled`. Use `weakRef` to allow GC.

### 21. No retry / health surface

**Problem:** UI can ask `getState().isReady` but cannot distinguish
"context running" from "worklets loaded". After a worklet load
failure, `getState().isReady` may still report true if the context
is running. There is no `getEngineHealth()` accessor and no
`lastInitError` field. UI gives no actionable feedback.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:150-169`

**Needed:** Add an internal `lastInitError` field, an
`engineHealthStore` that reflects fallback / worklet-load /
context-state, and surface a "Reload audio engine" affordance in the
UI (`AudioResumeOverlay` is the natural home).

### 22. Vite-specific worklet imports leak into tests

**Problem:** `?worker&url` is Vite plugin syntax. The single spec file
does not mock the import; under Vitest it resolves to whatever the
default resolver decides. Tests pass because `addModule` is mocked at
the `audioWorklet` level — the path string is never inspected.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:7-8`
- `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts`

**Needed:** Either add a Vitest config alias that resolves
`*?worker&url` to a stub string for tests, or move the URL constants
behind an injected dependency (`createAudioEngine({ workletUrls:
{ metering, recording, … } })`). The latter is more testable and
removes the Vite coupling from the unit boundary.

### 23. `resume()` and `suspend()` swallow errors silently

**Problem:** Both wrap `context.resume()`/`suspend()` in try/catch
and `logger.warn` on failure. The caller gets back a resolved
promise even when the context is still suspended. UI dismisses the
resume overlay and the user sees no audio.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:110-134`

**Needed:** Rethrow (or return a discriminated `Result<void, …>`).
Update callers to keep the overlay visible / show an error.
`AudioResumeOverlay.tsx:64,82` currently does `void resumeEngine()`
which swallows everything regardless.

### 24. No test for constructor catch / fallback path

**Problem:** Issue #3's complexity has zero coverage. The
`notifyUser` mock is set up
(`createWebAudioEngine.spec.ts:37-39`) but no test triggers it. No
test covers `setupNoopContext`, no test covers `fallbackMode = true`
behaviour.

**Representative files:**

- `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts`

**Needed:** Add a test that passes a constructor stub that throws on
`new AudioContext()` (or use vi.spyOn on `globalThis.AudioContext`)
and asserts `notifyUser` was called and that `getState().isReady ===
false`, `getMasterGain() === 0`, `setMasterGain(0.5)` is a no-op.

### 25. Stale 0-byte `src/modules/createWebAudioEngine` placeholder

**Problem:** A 0-byte regular file sits at
`src/modules/createWebAudioEngine` (no extension, not a directory).
It is not imported anywhere. Either an aborted refactor remnant or a
scaffold for a planned module split. Either way, it is not referenced
and should be either populated or removed.

**Representative files:**

- `src/modules/createWebAudioEngine`

**Needed:** Surface to the user (per AGENTS.md, deletion requires
explicit instruction). If a module split was planned (extracting the
factory into its own module folder under `src/modules/`), follow
through on it (move the factory, update imports). Otherwise have the
user delete the placeholder.

### 26. No barrier between core worklets loaded and plugin worklets loaded

**Problem:** `initialize()` loads five hard-coded worklets. After
`initializeAudioEngine` resolves, the bootstrap calls
`registerBuiltinPlugins` and `registerBuiltinFaustDSP` which
register more worklets. There is no public flag for "all worklets
ready". A `executeAppAction({ type: 'addDevice' …})` between core-
ready and plugin-ready will fail in unpredictable ways.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:99-108`
- `src/modules/AudioEngine/useCases/initializeAudioEngine.ts:11-19`

**Needed:** Either await all worklet registrations inside
`initializeAudioEngine` and only then resolve, or expose
`getEngineHealth().worklets` with a list of known-loaded modules and
let callers query.

### 27. `scheduledNodes` cleanup race

**Problem:** Each `scheduleOscillator` (`:489`) sets an `onended`
that splices the node out of `scheduledNodes`. If `stopAllScheduled`
runs first (`:517` sets `length = 0`), the not-yet-fired `onended`
calls `splice` on an empty array (no-op), but `env.disconnect()`
runs after the env has already been GC'd by the strip teardown. Not
a correctness bug (Web Audio is forgiving) but the pattern is
fragile.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:473-503,505-543`

**Needed:** In `stopAllScheduled`, set `osc.onended = null` on each
scheduled node before clearing, and explicitly disconnect each `env`.
Or use a `WeakRef`-backed scheduler and let GC handle it.

### 28. No tests for the riskiest methods

**Problem:** No test coverage for: `resume`, `suspend`, `setTrackPan`,
`setTrackMute`, `setSend`, `removeSend`, `wireSidechainRoute`,
`unwireSidechainRoute`, `setTransportInfo`, `getTransportSAB`,
`dispose`, `resetGraph`, `addDeviceToStrip`, the entire
`scheduleDeviceKey*` family, the AdjustmentLayer surface
(`applyAdjustmentLayerTick`, `resetAdjustmentLayers`,
`listLiveAdjustmentBusKeys`).

**Representative files:**

- `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts`

**Needed:** Build a typed `mockCtx` factory and add per-method
tests. The most valuable additions are: send create/update/remove
(audible UX bug today, issue #13), sidechain routing,
`setTransportInfo` SAB layout, `dispose` cleanup, fallback mode.

### 29. Tests use `as any` and `(global as any)` polyfills

**Problem:** AGENTS.md "TypeScript — soundness" forbids `any` in
tests. The spec uses `engine: any`, `mockCtx: any`,
`(global as any).AudioWorkletNode`,
`(global as any).SharedArrayBuffer`.

**Representative files:**

- `src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts:42-54`

**Needed:** Type `engine` as `ReturnType<typeof createAudioEngine>`.
Type `mockCtx` as `ReturnType<typeof createMockAudioContext>`. Move
the `AudioWorkletNode` / `SharedArrayBuffer` polyfills to a
dedicated Vitest setup file with proper `declare global` types.

### 30. `setTrackMute` calls `ensureTrackStrip` to create-on-mute

**Problem:** `setTrackMute(trackId, muted)` (`:223-226`) calls
`ensureTrackStrip(trackId)` before `setMute`. So muting a
not-yet-created track creates a strip as a side effect. Surprising —
the symmetric `setTrackGain`, `setTrackPan` use `?.setGain` /
`?.setPan` and silently no-op when the track is missing.
Inconsistent contract.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:215-226`

**Needed:** Decide on the contract — "mute creates the strip" or
"mute on missing strip is a no-op" — and apply uniformly. Document
on the interface.

---

## Open questions

- [ ] Is the `audioEngine` singleton's eager construction load-bearing
      anywhere, or is the laziness-via-`initialize` already enough? If
      callers mostly use `executeAppAction` and `initializeAudioEngine`
      already gates the bootstrap, the singleton can be lazy.
- [ ] Is the master meter intentionally TODO, or did the wiring used
      to exist and got removed? `git log -- src/modules/AudioEngine/repositories/createWebAudioEngine.ts`
      may reveal.
- [ ] What is the COOP/COEP story? Does the production build set the
      headers? If yes, issue #6 is a low-risk hardening; if no, it's a
      load-bearing crash on certain hosts.
- [ ] Does the `OfflineAudioContext` fallback need to actually work, or
      is its only purpose "don't throw on import"? The answer determines
      whether issue #3 needs a real `FallbackAudioEngine` or can stay a
      stub.
- [ ] Does any caller actually invoke `audioEngine.dispose()`? Search:
      no callers for `dispose` other than the impl itself. If unused,
      the incomplete teardown (issue #10) is latent — but tests should
      still cover the contract.
- [ ] Is the 0-byte `src/modules/createWebAudioEngine` (issue #25) a
      planned module-split scaffold? If so, what is the plan?

---

## Risks

- **Cross-environment crash on import.** Issues #1 + #6: a host page
  without COOP/COEP, a browser without `SharedArrayBuffer`, a Safari
  Lockdown profile, or an SSR boot all destroy the module on import,
  cascading into every cross-module use case that depends on it. There
  is no error boundary at the import site.
- **Permanent engine death after one bad worklet load.** Issue #4: a
  network blip (the `/audio/worklets/*.js` paths are static-served) or
  a stale build hash kills the engine for the rest of the session. The
  user has no signal beyond "audio doesn't work" and no recovery.
- **Silent meter readings.** Issue #5: master meter UI shows 0
  forever. Users believe the master is silent (or the meter is
  broken).
- **Torn transport state.** Issue #7: worklets reading the SAB can
  observe a beat from after a transport change paired with the tempo
  from before. At tempo changes during playback (rare but real for
  tempo-mapped projects), the audio thread can drift for one block.
- **Disposed strip references in sends/sidechain.** Issue #9: removing
  a track that has active sends leaves the send's `gainNode` connected
  to a disposed analyser. Disconnects on a disposed node throw on
  some browsers; on others they silently leak nodes.
- **`dispose` does not actually dispose.** Issue #10: project switching
  (which calls `resetGraph` rather than `dispose`) is mostly fine, but
  any caller assuming `dispose` is a clean reboot will see leaks and
  stale `initPromise` rejections.
- **Audible discontinuity on first send creation.** Issue #13: every
  newly-routed send pops to its target gain instantly, then ramps
  thereafter. Audible UX bug.
- **Architectural drift normalises positional args and eager singletons.**
  Issues #2, #14, #15 — every new module that imports this file sees
  the precedent and may copy it.

---

## Suggested approaches

- **Issue #1 first (eager singleton).** Move `audioEngine` to its own
  file with a lazy accessor (e.g. `export function getAudioEngine() {
return holder.instance ??= createAudioEngine() }`). All call sites
  switch from `audioEngine` to `getAudioEngine()`. This unblocks
  issues #6 and #25 (a singleton holder file is the natural home for
  the planned `src/modules/createWebAudioEngine/` split).
- **Issue #4 next (worklet retry).** Use `Promise.allSettled`,
  surface failures, allow retry. Cheap and high-leverage.
- **Issue #5 (master meter wiring or deletion).** Decide: wire
  `metering-processor` at master and forward via `port.onmessage`, or
  delete the API. Half-built APIs erode trust.
- **Issue #16 (Fallback engine class).** Once issue #1 is in, splitting
  the impl into `WebAudioEngineImpl` + `FallbackAudioEngine` is
  mechanical. Removes 12 `if (this.fallbackMode) return` branches.
- **Issue #7 (Atomic transport SAB).** Sequence-lock pattern, named
  offset constants, worker-thread test.
- **Issue #9 / #10 (cleanup).** One audit-pass over all `Map`s and
  cross-references at strip/bus/send removal time. Add tests.
- **AGENTS.md compliance pass.** Issues #14, #15, #29 — mechanical
  but cross-module. Land per method group.

---

## Recommendation

Start with **issue #1 (eager singleton)** — it is the root of issues
#6 (SAB load-time crash), #15/#29 (test polyfills), and the
ergonomics behind #25 (the 0-byte module placeholder). Move
`export const audioEngine = createAudioEngine()` to a
`getAudioEngine()` lazy accessor in a separate file (or directly into
`useCases/engineAccess/getAudioEngine.ts` which already partially
exists per the search at line 61 of `useCases/index.ts`). This is one
file move plus a sweeping import rewrite, all mechanical.

Then **issue #4 (worklet retry)** — the highest-impact pure-internal
fix that doesn't require touching call sites.

Then **issue #5 (master meter)** — decide and do. Either wire it or
delete it.

After those three land, the next session can tackle the
**Fallback engine split (#16)** + **transport SAB atomics (#7)** as a
correctness-and-architecture pass, with the AGENTS.md compliance
sweep (#14, #15, #29) and the test gaps (#28) as a follow-up.

---

## Resolved

_No issues resolved yet._
