# AudioEngine module audit

> **Adversarial review pass (2026-04-28).** Every numbered open issue was
> re-verified against the cited file:line; corrections applied where the
> original auditor was inaccurate (issues #5 mono vs stereo, #9 conflated
> two distinct meter paths, #29 handshake mechanism). New findings #63–#76
> added by the reviewer; new open issues #41–#55 follow them. Hidden bugs
> upgraded to P1 where the audit had buried them. The original audit
> downplayed several "broken silently" cases (Knead tuning-table, missing
> root barrel, MIDI PDC absent in offline render); those are now in
> Priorities.

## Scope

This audit covers `src/modules/AudioEngine/` in full — every file under
`engine/`, `services/` (AudioWorkletProcessor implementations), `workers/`,
`useCases/`, `repositories/`, `stores/`, `models/`, `handlers/`, and the root
`index.ts`. The module owns the live AudioContext, the AudioWorkletNode
wrappers for every WASM device, the metering and peak-tracking SAB telemetry,
the offline-render pipeline, the recording pipeline (AudioWorklet + OPFS
worker), the latency-compensation registry, and the device factories.

It is an adversarial review focussed on the audit prompt's hard targets:

- **Audio-thread RT discipline** — allocations, GC, locks, blocking, in
  AudioWorkletProcessor `process()` and inside the Grand Boule engine worker
  render loop.
- **AudioWorklet message-port back-pressure** — note flooding, telemetry
  overflow, init-handshake races.
- **SAB races, missing fences** — every `Atomics.{load,store,add}`-paired
  payload, plus the bare `Float32Array` writes that sit between control
  reads.
- **PDC correctness** — input/output latency compensation in
  `webMidi/messageHandlers` and `offlineRender/scheduleTrackClips`, the
  `externalLatencyRegistry` reporting path.
- **Buffer pool / cache exhaustion** — `audioBufferCache` LRU + waveform peaks
  + IndexedDB persistence, telemetry SAB allocator (64 slot cap).
- **Sample-rate / block-size assumptions** — hard-coded `48000`, magic
  `BLOCK_SIZE = 128`, max-block-size clamps that silently corrupt output.
- **Dispose / cleanup leaks** — telemetry callback registries, WeakMap-keyed
  worklet caches, telemetry slot release on hot reload, recorder OPFS file
  cleanup.

It deliberately excludes the **upstream** modules (Arrangement, Command,
Synth, the Bacteria/Fermenter/Gluten/Grinder/Levain/Proof/Scoring/Toaster
plugin modules) except where they are imported and consumed here.

Related spec: none on disk.

---

## Goal

A correctness-first realtime audio engine for the DAW:

- Every AudioWorkletProcessor `process()` must run with **zero allocation**,
  no mutex locks, no blocking I/O, no `postMessage` in the steady-state hot
  path. Telemetry pushes should use SAB + atomics with proper release/acquire
  fences (or memory order guarantees explicitly justified).
- Every SharedArrayBuffer read/write that crosses thread boundaries should be
  **synchronised via `Atomics`**: producers `Atomics.store` (or `Atomics.add`)
  the head index AFTER the data writes, consumers `Atomics.load` BEFORE
  reading the data.
- Plugin Delay Compensation (PDC) is **sample-accurate**: every reported
  latency goes through one canonical path (`externalLatencyRegistry`
  via `reportLatency`), the offline scheduler delays low-latency tracks by
  `(maxLatency − trackLatency)` ms, and the live MIDI input path subtracts
  `baseLatency + outputLatency + trackLatency` from recorded note times.
- AudioWorklet "ready" handshakes are race-free: the worklet acknowledges
  init before main-thread code posts further messages, and disposal closes
  the message port to stop in-flight messages.
- `dispose` paths actually free everything they own — telemetry slots,
  message-port listeners, OPFS files, scheduled timers, AudioContext nodes —
  and there are no module-level mutable singletons that survive HMR.
- Every cross-thread structured-clone path is justified — large payloads use
  `Transferable`, repeated payloads use SAB rather than postMessage.
- AGENTS.md hard rules: no `any`, no `as`-escapes, no `forwardRef`/
  `useMemo`/`useCallback`, no namespace imports, one function per use case,
  positional args replaced with single object params.

---

## Relevant code paths

- `src/modules/AudioEngine/index.ts`
- `src/modules/AudioEngine/useCases/index.ts` (cross-module surface)
- `src/modules/AudioEngine/stores/index.ts`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts` (the
  `AudioEngineImpl` god class plus the **module-level singleton**
  `audioEngine = createAudioEngine()` at the file footer)
- `src/modules/AudioEngine/engine/TrackNode.ts`,
  `BusNode.ts`, `AdjustmentBusNode.ts`, `AdjustmentLayerRuntime.ts`,
  `wasmDeviceRegistry.ts`, `telemetryAllocator.ts`, `workletInitShared.ts`,
  the per-plugin `*Node.ts` factories.
- `src/modules/AudioEngine/services/*Processor.ts` — every
  AudioWorkletProcessor (Bacteria, Fermenter, Gluten, GrandBoule, Grinder,
  Knead, Levain, Metering, Proof, ProofChamber, Recording, Scoring,
  Toaster).
- `src/modules/AudioEngine/workers/grandBouleEngineWorker.ts`,
  `recordingWorker.ts`.
- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/*` —
  PDC.
- `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts`
  (PDC application).
- `src/modules/AudioEngine/useCases/renderOffline.ts`,
  `decodeAudioFile.ts`, `audioBufferToWav.ts`,
  `repositories/audioRecorder/recording.ts`.
- `src/modules/AudioEngine/stores/audioBufferCache.ts` (LRU + waveform
  peaks + IDB).
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts`
  (PDC for live input recording).

---

## Current behavior

**Thread topology.** Every WASM device follows one of two patterns:

1. _Direct worklet WASM_ (Bacteria, Fermenter, Gluten, Grinder, Knead,
   Levain, Proof, ProofChamber, Scoring, Toaster) — the
   AudioWorkletProcessor `_initWasm` calls `initSync({ module })` to load
   the WASM exports inline, instantiates a Rust struct (e.g.
   `new GrinderInstance(sampleRate)`), then in `process()` (a) writes inputs
   into WASM linear memory via `new Float32Array(mem, inLeftPtr, frames).set(in0)`,
   (b) calls `inst.process(frames)`, and (c) reads outputs via another fresh
   `new Float32Array(mem, outLeftPtr, frames)` then `outChannel.set(view)`.
   Telemetry is written to a per-plugin SAB slot every 8 process calls.
2. _Worker-fed worklet_ (GrandBoule only) — a Web Worker holds the WASM
   engine and renders ahead into a SAB ring buffer; the AudioWorklet
   `process()` just `Atomics.load(writeHead, readHead)` and
   `out0.set(leftRing.subarray(...))`. The worker uses `MessageChannel`
   self-postMessage to schedule its render loop without `setTimeout` floor.

The recording pipeline mirrors topology 2: the
`recording-processor` AudioWorklet writes microphone input into a SAB
ring at `Atomics.add(writeHead, length)`, while a background Worker
periodically `Atomics.load(writeHead)` and drains to OPFS.

**TrackNode wiring.** `gainNode → preFaderTap → faderNode → postFaderGain →
panNode → meterNode (if SAB) → analyserNode → output destination`. The
device chain inserts itself between `gainNode` (track input) and
`preFaderTap`. Sends tap from `preFaderTap` (pre-fader) or `analyserNode`
(post-fader, post-pan, post-meter). Adjustment layer runtime can re-route
`analyserNode → adjustmentBus → master` instead of the default destination.

**Module-level singletons.** Three significant ones:

- `audioEngine = createAudioEngine()` at the bottom of
  `repositories/createWebAudioEngine.ts:600` — instantiated at import time,
  before any user gesture, allocating an `AudioContext` and a
  `transportSAB`.
- `externalLatencyRegistry = new Map<string, number>()` at
  `useCases/latencyCompensation/compensation/externalLatencyRegistry.ts:1`
  — a process-wide registry of plugin latencies in milliseconds.
- WASM binary cache and worklet-module cache in
  `engine/workletInitShared.ts:32,60`.

**PDC.** The offline render path adds `(maxLatency − trackLatency) / 1000`
seconds to clip start times in `scheduleTrackClips.ts:128,358-359`. The
live recording path (`webMidi/messageHandlers.ts:245-249`) subtracts
`baseLatency + outputLatency + trackLatency` from the recorded note start
beat. There is **no actual delay node inserted into the live audio graph**
— low-latency tracks are not delayed during real-time playback to align
with high-latency tracks.

**Telemetry SAB.** `telemetryAllocator.ts` owns a single 64-slot SAB
(64 × 32 floats = 8 192 bytes). Each plugin gets 32 floats. The
AudioWorkletProcessor writes every 8 process calls; the main thread polls
via `setInterval(..., 16)`. Reads and writes are bare typed-array
operations — no `Atomics`.

**Recording.** Microphone audio → AudioWorkletNode (`recording-processor`)
→ SAB ring (524 288 floats / ~10.9 s @ 48 kHz) → OPFS Worker drain → file.
Worker writes raw PCM to OPFS, then on stop opens a second writable with
`keepExistingData: true` and writes a 44-byte WAV header at position 0.

**Tests.** 235 spec files for 348 source files. ~75 spec files (≈ 32 %)
contain the literal phrase _"should export"_ — tautological tests of the
form `expect(subject.fn).toBeDefined()` with no behavioural coverage (e.g.
`useCases/latencyCompensation/compensation/__tests__/getCompensationDelay.spec.ts`,
`reportLatency.spec.ts`, every file under `useCases/controlRoom/__tests__`).

---

## Findings

1. **AudioWorkletProcessor `process()` allocates a fresh `Float32Array`
   view into WASM memory on every block.** Bacteria, Fermenter, Gluten,
   Grinder, Knead, Levain, Proof, ProofChamber, Scoring, and Toaster all
   construct **2–4 fresh `Float32Array(memory, ptr, frames)` views per
   render quantum** to copy audio in/out of WASM. While these are stack-cheap
   in V8, they are allocations, and AGENTS.md's "audio-thread rules" forbid
   allocation in `process()`. The fix is mechanical (cache views as fields,
   re-fetch on `wasm grow_memory` events). The cumulative footprint in V8
   is real: 12 plugins × 2-4 views × 375 quanta/sec = 9 000–18 000
   `Float32Array` allocations per second of active mixing. Representative:
    - `services/proofChamberProcessor.ts:111-112`
    - `services/proofProcessor.ts:131-132,137,140`
    - `services/scoringProcessor.ts:111,115`
    - `services/glutenProcessor.ts:154-155,163-164,171,174`
    - `services/bacteriaProcessor.ts:139-140,145,147,161`
    - `services/grinderProcessor.ts:342-343,352,355`
    - `services/fermenterProcessor.ts:199-205,225` (the latter
      _additionally_ allocates a `new Float32Array(128)` scope buffer per
      telemetry block and transfers it via `port.postMessage` — both are
      RT violations).
    - `services/levainProcessor.ts:280-283`
    - `services/kneadProcessor.ts:143-144,151,154,158`
    - `services/toasterProcessor.ts:194,197`

2. **Three AudioWorkletProcessors mutate dynamic queues from inside
   `process()`.** `FermenterProcessor._enqueue`, `LevainProcessor._enqueue`,
   and `ToasterProcessor._enqueue` use `Array.prototype.splice(lo, 0, msg)`
   to keep their per-sample-frame note queue sorted. `splice` allocates and
   shifts. The actual `_enqueue` is called from `port.onmessage` (control
   thread) — but **the AudioWorklet's `port.onmessage` callback runs on the
   audio thread** in the AudioWorkletGlobalScope. Any GC triggered by the
   array reshape blocks the next `process()` call. Representative:
    - `services/fermenterProcessor.ts:106` (`this._queue.splice(lo, 0, msg)`)
    - `services/levainProcessor.ts:142`
    - `services/toasterProcessor.ts:114`

3. **GrandBoule SAB ring buffer has no release fence between the data
   writes and the `Atomics.store` of `writeHead`.** The producer
   (`grandBouleEngineWorker.ts:125-132`) sequence is: `leftRing.set(...)` →
   `rightRing.set(...)` → `Atomics.store(controlInts, WRITE_HEAD_IDX,
   newWriteHead)`. The non-atomic typed-array writes are RELAXED in the JS
   memory model. The consumer
   (`grandBouleProcessor.ts:72-74`) does
   `Atomics.load(writeHead)` then `Atomics.load(readHead)` then bare
   `out0.set(this._leftRing.subarray(offset, ...))`. **The consumer's bare
   read can be re-ordered before the `Atomics.load`** — i.e. the worklet
   may read writeHead = N+1 (data should be there) but receive stale ring
   bytes from before the producer wrote them.
    - To get release/acquire semantics with SAB Float32 you need to either
      (a) write the data via `Atomics.store` on an Int32 view of the same
      memory (treating the float as bits), or (b) issue a fence by reading
      back the head with `Atomics.load` _after_ the bare data writes, and
      have the consumer use a corresponding `Atomics.load` discipline. The
      current code achieves neither.
    - Same pattern in `services/recordingProcessor.ts:62-65` (writes ring
      then `Atomics.add(writeHead, input.length)` — recording is more
      forgiving because the OPFS worker drains 50 ms behind, but the
      principle is identical).

4. **Telemetry SAB has no atomics at all.** `telemetryAllocator.ts:131` and
   the worklet write sites (e.g. `proofProcessor.ts:147-171`,
   `bacteriaProcessor.ts:154-162`, `grinderProcessor.ts:362-371`,
   `glutenProcessor.ts:181-186`, `scoringProcessor.ts:122-134`) all do
   bare `_sabView[idx] = value` writes. The main thread (e.g.
   `engine/ProofNode.ts:92-119` interval poll, `BacteriaNode`, etc.) reads
   bare `view[idx]`. Float32 reads and writes are not guaranteed atomic
   across threads. **Tearing is theoretically possible** (the IEEE-754
   bit pattern straddles 4 bytes; the spec only guarantees atomicity for
   `Atomics.load(Int32Array, ...)`), and the polled values can be from a
   half-written telemetry burst, presenting a brief glitch in metering UI.

5. **The recording worker's WAV-header patch corrupts the first 44 bytes
   of audio.** `workers/recordingWorker.ts:35-45` opens the OPFS file with
   `createWritable()` (default `keepExistingData: false` → truncate) and
   appends raw PCM as samples are drained. On `stopWorker`
   (`recordingWorker.ts:101-122`), it re-opens with `keepExistingData:
true` and writes a 44-byte WAV header at `position: 0`. **Position-0
   writes overwrite, they don't insert.** The recording is **mono
   Float32** per the WAV header (`setUint16(22, 1, …)` line 113), so
   44 bytes / 4 bytes-per-sample = **11 samples destroyed** — at 48 kHz
   that's ~0.23 ms of dropped audio at the start of every recording,
   plus a click from the discontinuity. (The audit originally framed
   this as 11 PCM samples — confirmed; the original auditor was right
   on the math.) Fix: reserve 44 bytes of header placeholder at the
   START of the file before draining begins, OR write zero PCM bytes
   for the first 44 bytes and patch in place — both shift the data
   region without destroying any samples.

6. **Recording-pipeline `Int32` overflow at ≈ 12 hours.**
   `services/recordingProcessor.ts:65` increments `writeHead` via
   `Atomics.add(this._writeHead, 0, input.length)` on a 1-element
   `Int32Array`. After 2³¹ samples (~12.4 hours @ 48 kHz of writes
   accumulated), `Atomics.add` wraps to negative. The worker
   (`recordingWorker.ts:52-53`) computes `available = currentWrite −
localReadHead`; once `currentWrite` is negative and `localReadHead` is
   positive, `available` is large-negative and `drain` returns early →
   recording stalls without warning. The same problem affects
   `grandBouleProcessor.ts` (writeHead/readHead are Int32 sample-counters)
   — the wrap interaction with `(readHead >>> 0) % ringFrames` is
   undefined-shaped because `>>> 0` re-interprets as unsigned but
   `ringFrames = 8192` does not divide `2³²`, so the modular index
   discontinuously jumps at the boundary. 12-hour sessions are unrealistic
   for recordings, but for live monitoring where the engine runs
   continuously the wrap _will_ happen during long sessions.

7. **`createWebAudioEngine.ts` instantiates an `AudioContext` at module
   import time.** `repositories/createWebAudioEngine.ts:600`:
   `export const audioEngine = createAudioEngine()`. The constructor
   creates `new AudioContext({ latencyHint: 'interactive' })` and a
   `SharedArrayBuffer(64)` for transport. This runs:
    - Before any user gesture (Chrome will warn and the context starts
      `suspended`).
    - During every test that imports anything from `useCases/index.ts`
      (which re-exports through this file). Tests do not reset the
      singleton between cases, so any test that mutates `pendingDevicePromises`,
      `trackNodes`, `busNodes` leaks state to the next test.
    - Before SAB cross-origin isolation has been verified — the constructor
      unconditionally allocates a `SharedArrayBuffer`, which throws if
      COOP+COEP are not set, leading to module-level failure with no
      recovery.

8. **`transportSAB` writes are non-atomic and read non-atomically.**
   `createWebAudioEngine.ts:362-369` writes 7 Float64 fields
   (`currentBeat`, `tempo`, `sampleRate`, `loopStart`, `loopEnd`,
   `isPlaying`, `isLooping`) into the transport SAB sequentially with bare
   `value[index] = …`. The Knead worklet
   (`services/kneadProcessor.ts:99-105`) reads `view[0]`, `view[1]`,
   `view[5]` bare. **A worklet `process()` call interleaved with the
   main-thread `setTransportInfo` write can observe `tempo` for the new
   tick but `currentBeat` for the previous tick** (or worse, a torn
   Float64). Result: pitch shifts computed from `(currentBeat / tempo) * 60`
   transiently produce a wrong song-time-seconds at every transport
   change.

9. **`getTrackPeakLevel` race on the SAB-backed meter buffer (per-track
   only).** `engine/TrackNode.ts:175-177` reads `meterBuffer[0]` then
   immediately writes `meterBuffer[0] = 0`. The audio-thread
   `MeteringWorkletProcessor.process` (`services/meteringProcessor.ts:51-53`)
   does the symmetric peak-aggregating
   `if (peak > this._sab[0]) this._sab[0] = peak;`. There are **no
   atomics, no fences, and no compare-and-swap** — between the main
   thread's read and zero-write, the worklet may have just observed the
   _stale_ pre-zero value and decided not to update; the new peak is
   silently dropped. UI reads "no peak" at moments of high signal level.
   The metering SAB is also only **4 bytes** (one Float32) for a stereo
   strip — `MeteringWorkletProcessor` accepts `channels: number` but
   writes only `_sab[0]`, so stereo content collapses to a single peak
   regardless of which channel was loudest.

   **Note**: the original audit listed `getMasterPeakLevel`
   (`createWebAudioEngine.ts:236-238`) here too. That was wrong — the
   master peak path is structurally **unwired** (no master meter
   worklet, `masterMeterBuffer` is a non-shared Float32Array allocated
   from `frequencyBinCount`); see new finding #63. The race description
   above applies only to the per-track meter SAB.

10. **`AudioWorkletNode.port.postMessage` is used as the steady-state
    parameter-update path for every WASM device.** `Bacteria/Fermenter/
    Gluten/Grinder/Knead/Levain/Proof/ProofChamber/Scoring/Toaster*Node.ts`
    all forward `setParam(name, value)` as a `postMessage` per call. With
    automation lanes firing per-sample, or a UI knob being dragged, the
    message-port is **back-pressure-free in the browser**: messages are
    queued but never coalesced, and the audio-thread `port.onmessage`
    handler runs all queued messages before the next `process()`. A user
    rapidly dragging a Faust slider can flood the worklet with thousands
    of param updates per second, each requiring a `set_param` WASM call.
    This is observable as audible CPU spikes during automation playback.
    The shared-mem param-update path used by `Grinder.parameterDescriptors`
    (`grinderProcessor.ts:319-327`) is the correct pattern but only used
    for nine of Grinder's 80+ params.

11. **`setBypass` does not actually bypass any device.** `FermenterNode`,
    `GrandBouleNode`, `LevainNode` (and via `setBypass` style controllers)
    all set a JavaScript-level `bypassed = state` flag inside the factory
    closure that **only gates `noteOn` posting**. `noteOff` is unguarded.
    The worklet keeps running, the engine keeps producing audio for any
    held notes, and re-enabling the device after any noteOff drops noteOns
    that arrived during the bypass window — leaving phantom-stuck notes
    in the engine queue that fire when the next noteOn → engine note-on
    is dispatched.
    - `engine/FermenterNode.ts:79-100`
    - `engine/GrandBouleNode.ts:122-135,159-161`
    - `engine/LevainNode.ts` (analogous; not shown but follows the same
      pattern from `wasmDeviceRegistry.ts:200-205`)
    - The audit-correct semantics are either (a) post `bypass` to the
      worklet which then short-circuits to passthrough, or (b) gate the
      `gainNode` ahead of the worklet to zero its contribution.

12. **`stopAllScheduled` floods the message port with 128 noteOffs per
    Fermenter / 16 per Toaster.** `repositories/createWebAudioEngine.ts:519-543`
    iterates every Fermenter device on every track and posts 128
    `noteOff` messages. With 5 Fermenter tracks active, that's 640
    structured-clone postMessages. The audio thread processes them all on
    the next quantum, which budget-blocks the next `process()` call.
    Levain has a dedicated `allNotesOff` path that avoids this; Fermenter
    and Toaster do not.

13. **PDC compensation is _delay-on-schedule_ for offline render but
    nothing at all for live playback.** `useCases/offlineRender/
scheduleTrackClips.ts:128-359` adds `compensationDelay = (max −
track) / 1000` seconds to clip iteration start times. This works because
    in offline rendering the entire timeline is scheduled ahead of time.
    During **live playback**, no equivalent path exists — there is no
    `DelayNode` inserted on low-latency tracks to align them with the
    high-latency master/bus path. The result: a project that includes a
    plugin with 50 ms of latency (Bacteria, Grinder, Proof) on a single
    track will play that track 50 ms later than every other track during
    live monitoring, while the offline render reports them aligned. The
    audit-correct fix is to insert a `DelayNode(compensationDelay)`
    between each track's `analyserNode` and its output destination during
    live playback.

14. **PDC for live MIDI input recording does not include input-device
    latency.** `repositories/webMidi/messageHandlers.ts:247`:
    `totalLatencySec = (ctx.baseLatency || 0) + (ctx.outputLatency || 0)
+ trackLatencySec`. **The MIDI controller's transport latency from
    physical key-press to `MIDIInput.onmidimessage` is missing.** USB MIDI
    is typically 1-3 ms; Bluetooth MIDI is 5-25 ms. For a live performer
    recording MIDI through a controller, the recorded note start beat
    will systematically lag the intended beat by the input latency.

15. **`externalLatencyRegistry` has no per-context partitioning.** The
    registry is a single `Map<string, number>` keyed by `deviceId`. If
    `resetAudioGraph()` is called (e.g. on project switch), it clears
    `pendingDevicePromises` but **does not clear the latency registry**.
    Stale device IDs from previous projects accumulate, increasing
    `getMaxTrackLatency()` artifically, which causes new projects to be
    delayed by orphan latencies that no real device contributes to. See
    `repositories/createWebAudioEngine.ts:545-574` (resetGraph misses the
    registry).

16. **`AdjustmentLayerRuntime.reset` does not call `wireChain` for the
    affected tracks.** `engine/AdjustmentLayerRuntime.ts:210-225` disposes
    every live bus, clears the `liveBuses` map, then calls `rerouteTrack`
    per affected track. But `wireChain(trackId)` is the function that
    actually walks `chainedBusesForTrack` and connects the chain to the
    final destination — `rerouteTrack` only triggers
    `TrackNode.routeOutput`, which connects the analyser to whatever
    `getAdjustmentBusForTrack` returns. After `reset`, the busOrderByTrack
    is cleared so `getAdjustmentBusForTrack` returns `null`, and
    `routeOutput` correctly bypasses the adjustment chain. So this is
    technically OK — but the symmetric path in `finalizeDisposal`
    (`AdjustmentLayerRuntime.ts:140-150`) does call `wireChain` _after_
    `removeLayerFromOrder`. Inconsistent — and `finalizeDisposal`'s
    `wireChain(trackId)` runs AFTER `removeLayerFromOrder` removed the
    bus, so the chain is shorter; the previous chain end never gets
    `disconnectDestination` called explicitly to remove the connection
    to the now-removed bus's input — relying on the bus's own `dispose`
    to disconnect upstream. Audible: brief click / orphan tail when an
    adjustment layer ends.

17. **`Knead`'s `process()` outputs left-channel-only into both stereo
    channels.** `services/kneadProcessor.ts:151-159`:
    `out1.set(wasmOutL)` — copies the LEFT WASM output to the right
    channel. The right input is processed by WASM (`wasmInR.set(input[1] ??
in0)`) but the right output pointer (`get_right_ptr`?) is **never
    fetched**. Every Knead-pitched track plays as collapsed mono. This is
    a correctness bug in the visible audio output.

18. **`Levain`'s `processFrames = Math.min(frames, 4096)` cap silently
    short-fills.** `services/levainProcessor.ts:265,277`. If `frames >
4096` the worklet calls `inst.process(processFrames)` and then
    `out0.set(new Float32Array(mem, leftPtr, processFrames))`. The
    remaining `frames − processFrames` samples in `out0` are left at
    whatever Web Audio's pre-`process` initialisation left them at
    (likely the previous-block leftover or zeros). Web Audio's render
    quantum is fixed at 128, so `frames > 4096` cannot occur today, but
    the cap is misleading: if a future spec change raises the quantum,
    this code corrupts output silently rather than failing.
    `services/grinderProcessor.ts:307-310` has a similar cap with a
    safer fallback to passthrough, but `Levain` does not.

19. **`Grinder.parameters` for-in walks prototype keys.**
    `services/grinderProcessor.ts:319`: `for (const name in parameters)`.
    The audio-thread `parameters` object is a plain dict from the browser
    — but if any future browser injects an `Object.prototype` extension
    (e.g. devtools shims, polyfills loaded into the AudioWorkletGlobalScope),
    this loop processes prototype keys as if they were AudioParams.
    `Object.keys(parameters)` is the correct iteration form, but it
    allocates an array. A typed-array iteration over a precomputed name
    list is the RT-correct fix.

20. **`telemetryAllocator` MAX_SLOTS = 64 is silently exhausted.**
    `engine/telemetryAllocator.ts:122-128` returns `null` when the free
    list is empty, with a `logger.warn`. Every device-creation path that
    consumes a slot (Bacteria, Gluten, Grinder, Proof, ProofChamber,
    Scoring) handles the null path by **skipping `init-sab`** — the
    worklet runs but never writes telemetry, and the UI quietly shows
    no metering. There is no way for the user to see "you ran out of
    plugin slots". With 12 different telemetry-emitting plugins and 64
    slots, a project with > 64 active metered instances (5–6 plugins
    per track × 16 tracks = realistic) silently loses metering for the
    overflow.

21. **Telemetry slot leaks on hot module reload.** The
    `TelemetryAllocator` instance is module-level (`telemetryAllocator =
new TelemetryAllocator()` at line 143). On HMR the allocator is
    re-created, freeing all slots, but the old `Float32Array` views
    handed to running worklets continue to write into the now-orphaned
    SAB. The new allocator's SAB is unrelated. Result: stale meter
    readings + orphaned worklets writing into dead memory.

22. **TrackNode meter buffer size mismatches the channels claim.**
    `engine/TrackNode.ts:62-67`: `new SharedArrayBuffer(4)` (1 Float32),
    then `meterNode.port.postMessage({ type: 'init', sab: meterSab,
channels: 2 })`. `MeteringWorkletProcessor` accepts the channel count
    but writes peak to `_sab[0]` regardless. The 4-byte SAB cannot store
    two channels even if the worklet wanted to. Effectively the
    "channels: 2" is dead config.

23. **`audioBufferCache.MAX_AUDIO_BUFFER_ENTRIES = 64` cap evicts active
    takes.** `stores/audioBufferCache.ts:39`. A power-user with 30 takes
    × 2 alt-takes plus imported samples blows the cap; LRU eviction
    silently drops a take's `AudioBuffer` from RAM. The take is recovered
    from IDB on next `audioBufferCache.get`, but: (a) the get is
    synchronous and returns `undefined` if the buffer is in IDB but not
    in cache (no automatic promote), (b) every consumer that called
    `audioBufferCache.get` and got `undefined` silently treats the take
    as missing (e.g. waveform render → empty array; offline render →
    skipped track with a warning). There is no async-warm path; calling
    code must explicitly `await audioBufferCache.restoreFromIdb([id])`
    first. None of the consumers do.

24. **`audioBufferCache.set` fires `void persistToIdb` and `void
updateAccessTimeInIdb` without awaiting.** Two consequences:
    - Multiple concurrent `set` calls on the same id (e.g. user
      re-imports the same file) race; either write may win in IDB
      regardless of order.
    - `getWaveformPeaks` is called immediately after `set`; if the
      caller depends on `lastAccessed` being current in IDB,
      `updateAccessTimeInIdb` may not have run yet — the GC paths
      (`garbageCollectByAge`) read `lastAccessed` from IDB and may
      delete the freshly-set buffer.

25. **`audioBufferCache.exportBuffers` does CPU-bound base64 encoding on
    the main thread.** `stores/audioBufferCache.ts:11-23` (`float32ToBase64`)
    yields every 32 chunks (~256 KB). For a project with 40 stereo takes
    × 30 sec each at 48 kHz, that's ~40 × 5.76 MB = 230 MB of
    base64-encoded data. At one yield per 256 KB the project save blocks
    the main thread for ~900 setTimeout(0) ticks (~14.4 s of UI freeze
    minimum from setTimeout's 4 ms floor). A Worker is the right home
    for this.

26. **`String.fromCharCode.apply(null, Array.from(bytes.subarray(...)))`
    in `float32ToBase64` is double-allocation per chunk.** Same file
    line 18: `Array.from(bytes.subarray(index, index + CHUNK))` allocates
    an 8 192-element JS Array, then `apply` spreads it as args. The
    `Array.from` is unnecessary — `String.fromCharCode.apply` accepts a
    `TypedArray` directly via the spread, OR you can use
    `TextDecoder('latin1').decode(bytes.subarray(...))`. The waste
    compounds at scale.

27. **`AudioEngineImpl.scheduleOscillator` registers an `onended` per
    note that mutates `scheduledNodes` array.**
    `repositories/createWebAudioEngine.ts:489-495`: every metronome click
    adds an oscillator to `scheduledNodes` and registers an `onended`
    that does `splice(idx, 1)`. With a click on every sixteenth note for
    a 5-min track, that's 600 oscillators allocated, 600 closures, 600
    array splices. Coupled with the rendering of `scheduleClick` in the
    rest of the engine, this is a cumulative leak unless the track is
    short. The simpler model is a click-track AudioWorkletNode that
    accepts a beat schedule and renders impulses sample-accurately.

28. **`stopAllScheduled` calls `node.stop(now)` without disconnecting
    the env GainNode.** `repositories/createWebAudioEngine.ts:510-517`:
    iterates `scheduledNodes`, calls `node.stop(now)`, then resets
    `scheduledNodes.length = 0`. The corresponding `onended` callbacks
    set up at `scheduleOscillator` line 489 _do_ disconnect the env, so
    this is correct as-is — but the onended is `setTimeout`-jitter
    sensitive (it fires when Web Audio calls back), so a forced stop
    before the env's `exponentialRampToValueAtTime` has finished can
    leave inaudible-but-allocated env nodes for ~50 ms.

29. **`ensureTrackStrip` in fallback mode allocates an orphan
    masterGainNode per track.** `repositories/createWebAudioEngine.ts:174-184`:
    when `fallbackMode` is true (no AudioContext), each call to
    `ensureTrackStrip` creates `const sG = ctx.createGain()` and uses it
    as the track's `masterGainNode` parameter. These orphan gain nodes
    are never connected to anything and never disposed. Over a session
    of project switches, they accumulate. The right fallback is to
    early-return a no-op strip object, not to allocate real nodes against
    the OfflineAudioContext placeholder.

30. **`renderOffline` `MAX_OFFLINE_FRAMES` clamp silently truncates
    long exports.** `useCases/renderOffline.ts:62`. The user has no
    way to know their export was truncated — the buffer is returned at
    the clamped size and `onProgress(1)` fires. A render of a 12-minute
    track at 192 kHz exceeds typical browser limits; the export silently
    becomes 8 minutes (or whatever the platform allows). Should error
    or split into chunks.

31. **`renderOffline` progress is fake.** `useCases/renderOffline.ts:177-183`
    fakes progress via an exponential ease toward 0.97 at a 100 ms
    interval, because `OfflineAudioContext.startRendering` does not
    expose progress. Lying about progress is OK as a placeholder, but
    coupled with `renderTimeoutMs` this creates a bizarre UX: a render
    that takes 11 s but times out at 10 s leaves the user looking at
    96 % progress for 1 s before failure.

32. **`exportStems` (and `renderOffline`) discard `pendingDevicePromises`
    timeout silently.** `repositories/createWebAudioEngine.ts:425-435`:
    `waitForDevices` clears `pendingDevicePromises` after a 10-second
    timeout and returns. **The pending devices are still loading** — the
    next render captures their output as silence (worklet runs but WASM
    isn't initialised). No warning surfaces to the caller.

33. **`decodeAudioFile` swallows all Tauri errors.**
    `useCases/decodeAudioFile.ts:25-50` wraps the entire Tauri path in
    `try { … } catch {}` and falls through to the browser path. A
    misconfigured Tauri binary, a missing native decoder, or a corrupt
    `tempPath` write all silently degrade to the browser decoder, which
    will either succeed (hiding the Tauri bug) or fail later with the
    browser's generic "format not supported" error. Plus
    `tempPath = ${tempDir}/../cache/${file.name}` does no path
    sanitisation — a file named `../../etc/secret.wav` writes outside
    the cache dir.

34. **`audioBufferToWav` does a per-sample for-loop on the main thread.**
    `repositories/audioEncoders/wavEncoder.ts:57-80`. For a 5-min stereo
    track at 44.1 kHz that's 26.5 M iterations of the outer loop, with
    `await new Promise(r => setTimeout(r, 0))` every 32 768 samples.
    `setTimeout(0)` has a 4 ms floor in browsers, so the encode time
    floor is `26.5e6 / 32768 × 4 ms ≈ 3.2 s` of pure setTimeout wait
    even on infinitely fast hardware. The encode itself is single-digit
    ms. A Worker is the right home; a `Float32Array` → `Int16Array`
    conversion in one shot uses ~50 ms even in single-threaded JS.

35. **`audioBufferToWav` 16-bit dither is a single TPDF, not noise-shaped
    and not RMS-bounded.** `wavEncoder.ts:50-52,61-62`:
    `Math.random() − Math.random()` per sample, then `sample +
dithered/0x8000`. This is the textbook formula but it lacks
    high-frequency emphasis (which professional dither uses to push
    quantisation noise above the audible band) and it's applied
    independently to L and R, decorrelating the noise. For a "transparent
    16-bit export" feature this is sub-par.

36. **`FermenterNode.setParam` accepts `number | number[]` but the
    worklet's `param` message is typed `value: number`.** Caller side:
    `engine/FermenterNode.ts:91-95` sends `value: number | number[]`
    via postMessage. Worklet: `services/fermenterProcessor.ts:46-47`
    declares `{ type: 'param'; name: string; value: number }`. The
    array branch passes a JS array through, then `inst.set_param(rustName,
msg.value)` in line 137 calls a Rust function expecting `f32`. The
    runtime behaviour depends on wasm-bindgen's coercion (likely
    error or NaN). The TS type is therefore lying — either typechecking
    fails or it doesn't, but production behaviour is unreliable for the
    array case (used for `tuning-table` per `engine/TrackNode.ts:138-141`).

37. **`TrackNode.registerTuningTable` uses `as any` to forward array to
    `setParam`.** `engine/TrackNode.ts:138,141`:
    `dn.kneadControls.setParam('tuning-table', frequencies as any)` and
    same for `fermenterControls`. AGENTS.md "TypeScript — soundness"
    forbids `as any`. The fix is to widen `setParam`'s signature to
    accept `number | number[]` properly through to the WASM bindings.

38. **`AudioEngineImpl` field types use `any`.**
    `repositories/createWebAudioEngine.ts:18`: `pendingDevicePromises:
Set<Promise<any>>` — declared as `Set<Promise<unknown>>` later (line
    37), but the type definition exposed via `AudioEngineState` keeps
    `any`. Cross-file inconsistency. Multiple call sites use `as any`
    casts to bridge the gap. `engine/TrackNode.ts:391`:
    `applyParams(dn as any, dn.type, …)` — same.

39. **`scheduleClick` dispatches to `scheduleOscillator` with hardcoded
    sample rate.** `repositories/createWebAudioEngine.ts:498-503`. The
    accent frequencies (1500 Hz / 1000 Hz) are fine, but the duration is
    seconds-based — fine for live; for offline render at non-44.1 kHz
    rates the click is rendered at the offline context's sample rate so
    it works, but `scheduleOscillator`'s `exponentialRampToValueAtTime`
    floor of `0.001` means at low sample rates (e.g. 8 kHz) the click
    has audible discontinuity at the ramp end.

40. **`audioBufferCache.getWaveformPeaks` mipmap level 1 is not
    invalidated on `audioBufferCache.set` for the same ID.** Wait:
    `audioBufferCache.set` at line 187 calls `clearWaveformCachesForId(id)`
    which clears both `waveformCache` _and_ `mipmapLevel1Cache` (via
    `clearWaveformCachesForId` at line 169-176). OK. But the LRU eviction
    in `audioCacheSet` at line 47-50 calls
    `clearWaveformCachesForId(lruKey)` only for the evicted key, not
    for the incoming. The waveform cache for the new buffer is fresh.
    OK — but if the same ID is set twice with different buffer contents
    (e.g. a clip-level edit), the second `set` correctly clears. So this
    is benign. (Audited; not a finding.)

41. **`AdjustmentBus` reverb param map is wrong.**
    `engine/AdjustmentBusNode.ts:42-46`:
    ```
    reverb: {
        Size: 'rev-mix',
        'Pre-Delay': 'rev-predelay',
        Damping: 'rev-lowcut',
        Decay: 'rev-decay',
    }
    ```
    "Size" maps to `rev-mix` (wet/dry), not to a room-size parameter.
    "Damping" maps to `rev-lowcut`. **Increasing reverb Size in the UI
    increases the wet level** — counter-intuitive and incorrect.
    Damping should affect high-frequency rolloff, not low-cut. This
    bleeds into the offline render adjustment-layer applier
    (`useCases/adjustmentLayer/`) producing audibly wrong reverb
    behaviour.

42. **`Faust` keyOn / keyOff use `setTimeout` for live scheduling.**
    `repositories/faustDeviceFactory.ts:52-71`. Live MIDI input through
    a Faust polyphonic synth uses `setTimeout(call, (time -
ctx.currentTime) * 1000)` to schedule the keyOn — **setTimeout has
    a 4 ms minimum and arbitrary jitter**. For a real-time MIDI
    controller, the audible result is timing inconsistency on the order
    of 4-16 ms per note. The comment ("for tighter real-time scheduling,
    a processor-side look-ahead scheduler would be required") acknowledges
    it but the code ships as-is.

43. **`Faust` offline scheduling stacks `suspend → resume` per note.**
    `repositories/faustDeviceFactory.ts:55-64`. For a project with N
    Faust notes during render, there are 2N async transitions that
    block startRendering progress. With 1 000 notes and ~5 ms per
    transition, that's 5 s of pure scheduler overhead beyond the actual
    DSP. Also, duplicate suspend at the same time silently fails (caught)
    and the call runs immediately — risk of "early note firing" during
    offline render.

44. **`getCompensationDelay` and `reportLatency` tests are tautological.**
    `useCases/latencyCompensation/compensation/__tests__/` —
    `getCompensationDelay.spec.ts:6-10` and `reportLatency.spec.ts:6-10`
    just assert the function is defined. No behaviour coverage. Same
    pattern across ~75 spec files (≈ 32 % of the module's tests).
    AGENTS.md "Tests: Do not stop at 'defined' / 'truthy' / generic
    `toBeTypeOf('object')'" — wholesale violation.

45. **`AudioEngineImpl.dispose` does not terminate plugin Workers.** The
    Grand Boule engine Worker is owned by `GrandBouleNode`'s closure;
    on `audioEngine.dispose` the master nodes are disconnected and the
    AudioContext is closed, but `engineWorker.terminate()` is only
    reached via the per-device `destroy()` path. If the engine is
    disposed while a plugin is mid-load (or `pendingDevicePromises`
    contains an in-flight create), the Worker is leaked. Same risk for
    the recording Worker.

46. **`pendingDevicePromises.clear()` in `resetGraph` orphans in-flight
    plugin loads.** `repositories/createWebAudioEngine.ts:573`. The
    promises are cleared from the tracking set, but the underlying
    fetch+compile work continues. When the load resolves it tries to
    `onLoaded` swap the placeholder in a now-disposed strip — which
    silently succeeds (the strip's `deviceNodes` array has been replaced)
    or throws inside the resolver. Either way, the WASM instance is
    instantiated and immediately orphaned — wasted memory.

47. **`ProofNode`'s `setParam` early-returns when `bypassed`.**
    `engine/ProofNode.ts:131-135`. Param updates are dropped while
    bypassed; on un-bypass, the most recent param state is missing. UI
    that updates a knob during bypass shows a stale value when un-bypass
    is toggled. The audit-correct fix is to coalesce the latest pending
    param value in main-thread state and flush on un-bypass.

48. **`Grinder.parameterDescriptors` are not the param dispatch surface.**
    `services/grinderProcessor.ts:213-226` declares 9 a-rate AudioParams
    but `engine/GrinderNode.ts` (not shown but invoked via
    `wasmDeviceRegistry.ts:407-490`) sends ~80 params via `port.postMessage
{ type: 'param' }`. The parameterDescriptors path supports
    sample-accurate automation but is unused by the rest of the param
    surface. Inconsistent.

49. **`Fermenter` telemetry transfers a fresh `Float32Array(128)` per
    burst.** `services/fermenterProcessor.ts:225-230`. Even with
    `Transferable`, the allocation happens on the audio thread.
    Telemetry should write into a SAB slot like every other device.

50. **`onTelemetry` callbacks have no removal API.**
    `engine/FermenterNode.ts:102-104,123` adds listeners to a
    `telemetryListeners: Set<...>` but never removes them. On device
    re-creation (e.g. user replaces the synth), the closure-captured
    callbacks are leaked. `engine/ProofNode.ts:146-148,165-170`,
    `BacteriaNode`, `GlutenNode`, `GrinderNode`, `ScoringNode` follow
    the same pattern — `onMeterData(cb)` mutates a single nullable
    callback, not a Set, so the leak is bounded to one stale closure
    per device replacement, but the absence of an `off`-API is uniform.

51. **`audioEngine.context` is mutated by `setupNoopContext` to an
    `OfflineAudioContext` with a unique `as BaseAudioContext as
AudioContext` cast.** `repositories/createWebAudioEngine.ts:81-92`.
    AGENTS.md forbids `as` to bridge incompatible types. Worse: any
    consumer that calls `.resume()` or accesses `outputLatency`,
    `baseLatency` on the noop context will hit `undefined` / no-op — but
    the callers don't know they're in fallback mode. The
    `getMasterPeakLevel`, `setMasterGain`, and `getState` paths all
    early-return on `fallbackMode`, but `getAudioContext()`,
    `ensureTrackStrip`, `decodeAudioFile`, and consumers of
    `audioEngine.context` directly do not check.

52. **`Recording` `acquireSharedMediaStream` use-count race.**
    `repositories/audioRecorder/recording.ts:62-80`. `usageCount` is
    incremented after `getUserMedia`. If two callers race the first
    `getUserMedia` request, both await it; both then `usageCount++` →
    count = 2 with one stream. On release, count goes to 1, stream
    stays alive. On second release, count goes to 0, stream stops.
    OK — but if a third caller arrives between the first release and
    the second, it sees `usageCount = 1 > 0` and does NOT request a
    new stream, even though the stream is about to be stopped. There's
    no Promise coalescing for the in-flight `getUserMedia`.

53. **`Recording` worker `init`-then-`start` ack only confirms worker
    side.** `recording.ts:172-186`. The `recording-processor` worklet
    receives `init` and silently configures the SAB; there is no
    "worklet ready" reply. The main thread sends `start` to the
    worklet immediately upon worker `ready`. If worklet-side init has
    not yet been processed (ports run on the audio thread, possibly
    behind a long `process()`), the first `start` is processed before
    the SAB view is set, and the worklet returns `true` from process
    without writing. First few hundred milliseconds of audio are lost.

54. **`Recording` start audio capture but `_active = true` order.**
    `recordingProcessor.ts:38-39`. The worklet handler sets
    `this._active = true` on `start`. There's no fence; the next
    `process()` call reads `_active` and may still see `false` due to
    JIT reorder (less likely in practice but theoretically possible
    for a non-volatile field).

55. **`createWebAudioEngine` directly imports `notifyUser`.**
    `repositories/createWebAudioEngine.ts:2`. AGENTS.md "Repositories
    Touch Metal" — repos do I/O, not UX dispatch. `notifyUser` is a
    cross-module side effect that belongs in a use case wrapping the
    engine constructor. Mostly a layering nit, but significant because
    `notifyUser` synchronously enqueues a notification before the
    engine is even returned to the caller.

56. **Module barrel re-exports types from useCases.**
    `useCases/index.ts:18,21,37,89,94,131`: `export type {
AudioDeviceInfo }`, `SynthParams`, `MpeParams`, `DeviceNodeEntry`,
    `MidiGenerationNote`, `OfflineRenderOptions`, `MidiInputInfo`.
    AGENTS.md "Use-case types stay private" — `do not export type
from useCases/`. Same pattern recurs. The root
    `index.ts` re-exports the entire useCases barrel.

57. **`linkBridge.LinkStatus` uses snake_case TypeScript fields.**
    `repositories/linkBridge/helpers.ts:7-14`: `num_peers: number`.
    AGENTS.md "Variables and functions MUST use snake_case (worm
    case)" applies to the **backend** Rust/Tauri CLI, not to the JS
    frontend, where camelCase is enforced (see existing TS code
    style across the rest of the module — `numberOfChannels`,
    `sampleRate`, `currentTime`). The Tauri serde boundary will pass
    the field through; renaming on the JS side requires a
    transformer.

58. **HMR-leaked WebMIDI state.** `repositories/webMidi/state.ts:13-18`:
    `_midiAccess`, `_activeInput`, `_targetTrackId`,
    `_tauriEventUnlisten` are module-level mutable singletons. HMR
    re-runs the module → these reset to `null` while the actual
    `MIDIAccess` callbacks remain wired to the previous module
    instance. Hot-reload during a dev session leaves duplicate MIDI
    handlers active; every keypress fires twice. Same risk for
    `activeNotes` Map.

59. **`audioBufferToFlac`/`audioBufferToMp3` not audited.** Their
    encoder repositories (`flacEncoder.ts`, `mp3Encoder.ts`) follow
    the same shape as `wavEncoder` — single-threaded, blocking.
    Likely the same Worker-able pattern. Not investigated in detail
    here.

60. **`paramSignature` is O(N log N) per `applyTick`.**
    `engine/AdjustmentLayerRuntime.ts:46-53`. Sort + string concat per
    active layer per tick. Per-tick is main-thread, ~60 Hz, with
    typically < 10 active layers — bounded. Still a wasted allocation
    target; a numeric hash would be cheaper.

61. **`AdjustmentBusNode` initial wet/dry both 0.** Lines 119-121:
    `dryGain.gain.value = 0`, `wetGain.gain.value = 0`. From bus
    construction until the first `setBlend` (the next line in the
    runtime, line 128), both signals are silenced. With a sequencer
    that calls `applyTick` every 16 ms, the first tick has wet/dry =
    0, then setBlend's `setTargetAtTime` ramps. Audible click on
    layer entry.

62. **`scheduledNodes` array uses `indexOf + splice` on remove.**
    `repositories/createWebAudioEngine.ts:489-495`. With many
    concurrent oscillators (metronome + audition notes), each `onended`
    is O(N) on a Map-keyed structure. A `Set<AudioScheduledSourceNode>`
    is O(1).

63. **The "master peak" path is not SAB-backed at all and silently
    returns 0 after the first read.** `repositories/createWebAudioEngine.ts:62`
    sets `this.masterMeterBuffer = new Float32Array(this.masterAnalyser.frequencyBinCount)`
    — a non-shared `Float32Array` allocated against the AnalyserNode's
    `frequencyBinCount` (128 floats). `getMasterPeakLevel()` (line 236)
    reads `masterMeterBuffer[0]` and writes 0 — **but nothing ever
    populates this buffer.** The class declares `masterMeterNode:
    AudioWorkletNode | NoopMeterNode` (line 29) but the live (non-fallback)
    constructor never instantiates a `metering-processor` for the master,
    never calls `getFloatTimeDomainData(this.masterAnalyser)`, never wires
    a worklet to write into `masterMeterBuffer`. The first call returns
    whatever `Float32Array` was initialized with (zeros) and writes 0;
    every subsequent call returns 0. Audit issue #9 conflated this with
    the per-track meter SAB; the master-meter case is **strictly worse**
    — the meter is structurally unwired, not racy. UI display shows a
    flat master meter at all times unless `setupNoopContext` ran, which
    sets `masterMeterBuffer = new Float32Array(1)` (line 91) and is also
    never written.

64. **PDC compensation is applied to audio clips but NOT to MIDI events
    in offline render.** `useCases/offlineRender/scheduleTrackClips.ts:268-272`
    schedules MIDI note times as `beatToSeconds(noteAbsStart, …)` — no
    `+ compensationDelay`. In contrast, audio clip iteration (line
    358-359) does add `compensationDelay`. So a project with a MIDI
    track on a low-latency synth and an audio clip on a high-latency
    plugin renders them with **inconsistent** compensation: the audio
    is delayed (correct) but the MIDI synth's notes fire on the
    uncompensated grid. Hard correctness bug for any mixed-content
    project that happens to land near zero latency on its MIDI tracks
    and significant latency elsewhere.

65. **Latency reporting is only wired for 4 of 12 plugins.** Only
    Bacteria, Gluten, Grinder, and Proof descriptors call
    `reportLatency` (`engine/wasmDeviceRegistry.ts:327, 370, 376, 437,
    446, 507, 513`). Knead, ProofChamber, Levain, Toaster, Fermenter,
    Faust, Scoring, GrandBoule descriptors **do not call `reportLatency`
    even once**. Every one of these has measurable latency:
    - **GrandBoule** renders `TARGET_AHEAD = BLOCK_SIZE * 6 = 768
      samples ≈ 16 ms` of look-ahead in the engine worker
      (`workers/grandBouleEngineWorker.ts:34`) → reported as zero.
    - **ProofChamber** is a reverb (predelay parameter is exposed,
      `engine/AdjustmentBusNode.ts:43`) → reported as zero.
    - **Knead** is a pitch shifter (overlap-add buffer = block latency)
      → reported as zero.
    - **Toaster** has a `lookahead` concept (transient shaper) → zero.
    `getMaxTrackLatency()` therefore under-estimates whenever any of
    these plugins sit on the longest path; the offline scheduler then
    delays low-latency tracks by less than required, producing audible
    misalignment that the UI claims is compensated.

66. **`AudioEngine` module has no root `index.ts`.** `find -maxdepth 1
    -name "index.ts"` returns nothing. AGENTS.md "Contract Boundaries":
    "Cross-module imports MUST only target the destination module's
    root `index.ts`". External consumers reach into
    `#/modules/AudioEngine/useCases`, `#/modules/AudioEngine/events`,
    `#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip`
    (the last is a deep import in test code), bypassing the (missing)
    barrel entirely. Compound violation: every consumer module silently
    depends on the internal directory layout of AudioEngine.
    Representative external imports:
    - `app/bootstrap.ts:27`: `from '#/modules/AudioEngine/useCases'`
    - `modules/Toaster/useCases/__tests__/triggerPad.spec.ts:5`:
      `from '#/modules/AudioEngine/useCases'`
    - `modules/Toaster/useCases/__tests__/createDrumTrackStack.spec.ts:7`:
      `from '#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip'`
      (deep import).

67. **`wasmBinaryCache` is module-level Map that survives HMR.**
    `engine/workletInitShared.ts:60`: `const wasmBinaryCache =
    new Map<string, Promise<ArrayBuffer>>()`. Survives HMR because it's
    not wrapped in `createHmrPersistentState`. The `WeakMap` for worklet
    registrations (line 32) self-cleans when the AudioContext is GC'd,
    but the WASM cache holds onto the bytes indefinitely. Coupled with
    GrandBoule's separate `cachedGrandBouleWasm: ArrayBuffer | null`
    (`engine/GrandBouleNode.ts:32`), every HMR doubles the cached WASM
    footprint (~3-10 MB per build). Long dev sessions accumulate
    100+ MB of orphaned WASM bytes.

68. **`recordingProcessor.ts` does per-sample modulo on the audio
    thread.** `services/recordingProcessor.ts:62-64`:
    `for (let index = 0; index < input.length; index++) {
    this._ring[(head + index) % ringSize] = input[index] ?? 0; }`.
    `% ringSize` is a 32-bit integer modulo per sample × 128 samples =
    128 modulo ops per render quantum, plus the `?? 0` branch. The
    correct pattern is to compute `firstChunk = min(input.length,
    ringSize - (head % ringSize))` once, then two `subarray + .set`
    copies. Same allocation-free, but ~30× faster than per-sample.

69. **Knead's `tuning-table` parameter is silently dropped — the worklet
    only handles `shift_semitones`.** `services/kneadProcessor.ts:53-56`:
    `if (msg.type === 'param' && this._instance !== null && this._ready)
    { if (msg.name === 'shift_semitones') { this._instance.set_shift_semitones(
    msg.value); } }`. Any other param name (including `tuning-table`)
    silently falls through. **`TrackNode.registerTuningTable`
    (`engine/TrackNode.ts:138`) actively calls
    `dn.kneadControls.setParam('tuning-table', frequencies as any)`** —
    so `registerTuningTable` for Knead-equipped tracks is a no-op. The
    `as any` (audit issue #37) hides that the value type is wrong AND
    that the param name is unhandled. End-to-end: tuning tables are
    never applied to Knead's pitch shift.

70. **Knead's `process()` allocates a closure per block via
    `activeClip.blobs.find(...)` and does prototype-chain iteration.**
    `services/kneadProcessor.ts:106` does `for (const clipId in
    this._clips)` — same prototype-walk concern as Grinder (audit
    issue #19). Line 119-121: `blob = activeClip.blobs.find((b) =>
    clipTimeSeconds >= b.startTime && clipTimeSeconds <= b.endTime)`
    — `Array.prototype.find` allocates a closure scope per call;
    runs every block when `isPlaying`. At 48 kHz/128 quantum that's
    ~375 closure allocations per second per Knead-equipped track.

71. **AdjustmentLayerRuntime.reset() bypasses the fade-out grace
    timer and disposes buses immediately.** `engine/AdjustmentLayerRuntime.ts:210-225`:
    `reset` iterates live buses, calls `clearTimeout(disposalTimer)`
    if any, and immediately calls `live.bus.dispose()` — skipping the
    `FADE_OUT_GRACE_MS = 300` grace path used in `applyTick` (lines
    195-200). The bus's `wetGain` / `dryGain` are still at the
    last applied values when `dispose()` runs. Audible discontinuity
    on every project switch / reset / adjustment-layer purge.

72. **OPFS recording temp file leaks when the worker is terminated
    mid-flush.** `repositories/audioRecorder/recording.ts:240-247`:
    `terminateWorker(session)` is called from `decodeAndDeliver`
    AFTER `ctx.decodeAudioData` succeeds. The wav buffer reaches main
    via `postMessage({type:'wav', buffer}, [arrayBuffer])` (worker
    line 128); the worker's `try { …removeEntry(tmpName) }` in the
    SAME `stopWorker` chain (line 130-136) runs AFTER the postMessage.
    If main calls `terminateWorker` between the `postMessage` and the
    `removeEntry`, the temp file `rec-tmp-<timestamp>.pcm` survives in
    OPFS forever. Same risk if `recordingWorker.onerror` fires — the
    cleanup branch does not invoke OPFS file removal.

73. **`acquireSharedMediaStream` lacks Promise coalescing — concurrent
    callers each await the same `getUserMedia` but increment `usageCount`
    for the same physical stream.** `repositories/audioRecorder/recording.ts:62-68`.
    First caller starts `getUserMedia`, second caller arrives during the
    first's `await` — the second sees `sharedStreamState.stream === null`
    and starts a SECOND `getUserMedia`. Both eventually resolve; both
    `usageCount++`. Result: count = 2 with two competing streams (one is
    discarded by the assignment `sharedStreamState.stream = await
    getUserMedia(…)` — the second one wins). The first tracks are now
    orphaned. Worse: on release, count goes 2→1→0 and the WINNER stops
    on the second release, but the LOSER's tracks were never `.stop()`ed
    — mic activity light stays on. Fix: cache the in-flight Promise
    itself (line 64), so concurrent callers `await` the same Promise.

74. **`recordingProcessor` lacks any `init`-completion ack — the
    worklet has no observable "ready" state, so the start-flow has a
    hidden race.** `services/recordingProcessor.ts:30-37`. The `init`
    handler runs synchronously to set `_writeHead` / `_ring`, but the
    handler runs on the audio thread and may queue behind a long
    `process()` call. Main thread sends `init` then `start` to the
    worklet (`recording.ts:148, 175`). If the audio thread is busy, the
    worklet processes `start` BEFORE `init`, sets `_active = true` while
    `_ring` is null, and `process()` early-returns (line 52-54). First
    audio is silently dropped until the next `port.onmessage` cycle. The
    audit's issue #29 framed this as a worker-vs-worklet race; the
    actual race is **inside** the worklet's own message ordering. Add a
    `port.postMessage({type:'ready'})` in the `init` branch and gate
    the main-thread `start` on it.

75. **`Atomics.add(this._writeHead, 0, input.length)` is a relaxed
    atomic on a value that the consumer reads with relaxed
    `Atomics.load`.** `services/recordingProcessor.ts:65`. Without a
    release-acquire pair, the consumer (`workers/recordingWorker.ts:52`)
    reading `currentWrite = Atomics.load(writeHead, 0)` and then doing
    bare `ring[(localReadHead + index) % ringSize]` (line 62) can read
    ring values written **before** the producer completed the `for`
    loop that wrote them. The audit's issue #3 framed this as fence
    absence; the recording case is identical to GrandBoule's but with
    a smaller blast radius (the OPFS drain is delayed and tolerates
    occasional zero samples in a wraparound window).

76. **`KneadNode` has no `destroy()` exported and no SAB slot to release.**
    `engine/KneadNode.ts:60-72` returns `{workletNode, setParam,
    setBypass, updateState, ready}` — no `destroy`. The descriptor
    in `wasmDeviceRegistry.ts:766-787` provides a destroy via
    closure that disconnects + closes the port. But unlike the other
    nodes, Knead does not allocate a telemetry slot and does not
    need to release one. The asymmetry creates a foot-gun: a future
    refactor that adds telemetry to Knead must remember to wire
    destroy in BOTH places. Symptom of a missing pattern, not a leak.

---

## Priorities

> Re-prioritised after adversarial review. Hidden P1s promoted from the
> Findings section: #63 (master peak unwired), #64 (PDC missing on
> MIDI), #65 (latency reporting missing on 8/12 plugins), #69 (Knead
> tuning-table is a no-op).

1. **The "master peak" path is structurally unwired and silently
   returns 0** (finding #63 / open issue #41). Adversarial finding —
   the audit originally lumped this with the per-track meter race.
   Master meter UI is dead.
2. **Knead's `tuning-table` parameter is silently dropped — alternative
   tunings do not apply on Knead-equipped tracks** (finding #69 /
   open issue #44). End-to-end correctness bug for any project using
   custom temperaments with Knead.
3. **PDC compensation is NOT applied to MIDI events in the offline
   render — only to audio clips** (finding #64 / open issue #42). DAW
   correctness bug; the offline render mis-aligns MIDI vs audio
   whenever any track has non-zero plugin latency.
4. **8 of 12 plugins fail to report any latency** (finding #65 /
   open issue #43). GrandBoule (16 ms look-ahead), ProofChamber
   (predelay), Knead (block-latency), Toaster, Levain, Fermenter,
   Faust, Scoring all report zero, so PDC silently mis-aligns them.
5. **SAB races without atomic fences across the GrandBoule ring,
   recording ring, telemetry slots, and meter peaks** (issues #3, #4,
   #9, finding #75). The race window is small but the consequence is
   silent audio corruption — torn ring reads, lost peaks, transient
   torn telemetry.
6. **The recording WAV header overwrites the first 44 bytes of every
   recording** (issue #5). Easy fix, audible click on every take.
7. **Knead's right channel collapses to mono** (issue #17). Visible
   in any stereo-content workflow that uses pitch editing.
8. **Module-level `audioEngine` singleton allocates an AudioContext at
   import time** (issue #7). Affects every test, every dev reload, and
   produces a "user gesture required" warning on first load.
9. **PDC has no live-playback delay path** (issue #13) and missing
   input-controller latency (issue #14). DAW-grade incorrectness.
10. **`Float32Array(memory, ptr, frames)` allocations in every
    AudioWorklet `process()`** (issue #1). Twelve plugins × 2-4 allocs
    × 375 quanta/sec = thousands of typed-array headers per second.
11. **`setBypass` is a JS-side flag that doesn't bypass the device**
    (issue #11). User-visible incorrect behaviour with no audio change.
12. **AudioEngine module has no root `index.ts`; cross-module imports
    bypass the (missing) barrel** (finding #66 / open issue #46).
    AGENTS.md violation that will block any future deps:validate
    tightening.
13. **`recordingProcessor` Int32 writeHead overflows at ~12 hours**
    (issue #6). Long sessions silently lose data without a warning.
14. **`stopAllScheduled` floods 128 noteOff messages per Fermenter
    per stop** (issue #12). CPU spike + back-pressure on every
    transport stop.
15. **AdjustmentBus reverb-Size param maps to wet/dry mix** (issue
    #41). Audible misbehaviour on every Reverb adjustment.
16. **AdjustmentLayerRuntime.reset() bypasses fade-out grace** (finding
    #71 / open issue #47). Click on every project switch.
17. **Test tautologies — ~32 % of specs assert only "function is
    defined"** (issue #44). The behaviour-side coverage is much smaller
    than the file count suggests.

---

## Open issues

### 1. AudioWorklet `process()` allocates `Float32Array` views on every block

**Problem:** Ten WASM-backed plugins construct fresh `Float32Array(memory,
ptr, frames)` views each block to pipe audio in/out of WASM linear memory.
AGENTS.md forbids audio-thread allocations. While V8 inlines and stack-
allocates these typed-array headers when they don't escape, the views are
written to via `.set()` (escape) and the optimisation isn't guaranteed.

**Representative files:**

- `src/modules/AudioEngine/services/proofProcessor.ts:131-132,137,140`
- `src/modules/AudioEngine/services/glutenProcessor.ts:154-155,163-164,171,174`
- `src/modules/AudioEngine/services/grinderProcessor.ts:342-343,352,355`
- `src/modules/AudioEngine/services/bacteriaProcessor.ts:139-140,145,147,161`
- `src/modules/AudioEngine/services/levainProcessor.ts:280-283`
- `src/modules/AudioEngine/services/kneadProcessor.ts:143-144,151,154,158`
- `src/modules/AudioEngine/services/toasterProcessor.ts:194,197`
- `src/modules/AudioEngine/services/fermenterProcessor.ts:199-205,225`
- `src/modules/AudioEngine/services/scoringProcessor.ts:111,115`
- `src/modules/AudioEngine/services/proofChamberProcessor.ts:111-112`

**Needed:** Cache views as fields after `_initWasm`. Refresh views when
`memory.buffer` changes (WASM `grow_memory` event — observable via the
buffer's `.byteLength` or by re-reading after every WASM call that may
grow). For Rust WASM bindings that pin memory size at startup, the cache
never needs invalidation.

### 2. AudioWorklet note queues use `Array.splice` to insert sorted

**Problem:** `FermenterProcessor`, `LevainProcessor`, `ToasterProcessor`
each maintain a `_queue: Queued[]` array of sample-frame-tagged events.
`_enqueue` does a binary search then `_queue.splice(lo, 0, msg)` — splice
is allocation-heavy. The handler runs on the audio thread (the
AudioWorkletGlobalScope shares a thread with `process()`).

**Representative files:**

- `src/modules/AudioEngine/services/fermenterProcessor.ts:94-107`
- `src/modules/AudioEngine/services/levainProcessor.ts:130-143`
- `src/modules/AudioEngine/services/toasterProcessor.ts:102-115`

**Needed:** Replace with a fixed-capacity ring buffer or sorted insertion
into a pre-allocated `Float32Array`/`Int32Array` (since the messages are
small structs of numbers). Drop messages with a logger.warn rather than
allocating when the buffer is full.

### 3. SAB ring buffers lack release-acquire fences

**Problem:** Producers write data via bare `Float32Array.set(...)` then
publish via `Atomics.store` on an Int32 head. Consumers read the head
via `Atomics.load` then bare `subarray + set`. The non-atomic
typed-array writes are RELAXED in the JS memory model and can be
re-ordered around the `Atomics.store`. The consumer's bare ring read
can see writeHead = N but receive stale ring bytes.

**Representative files:**

- `src/modules/AudioEngine/workers/grandBouleEngineWorker.ts:114-132`
- `src/modules/AudioEngine/services/grandBouleProcessor.ts:72-100`
- `src/modules/AudioEngine/services/recordingProcessor.ts:60-66`

**Needed:** Either (a) write the data via `Atomics.store` on an Int32
view of the same ring memory (treating Float32 bits as Int32) — slow
but correct; (b) use `Atomics.exchange`/`Atomics.compareExchange` on the
head index as a release fence (the spec orders them with respect to
non-atomic ops on the same SAB); or (c) make the producer write +
publish sequence indirected via two head indices ("uncommitted" and
"committed") — see `rtrb`-style SPSC lock-free ring buffer.

### 4. Telemetry SAB has no atomic discipline

**Problem:** `telemetryAllocator.ts` slots are read/written as bare
`Float32Array[idx]` access. Reads on the main thread can see torn
Float32 bits; writes have no fence ordering with each other (so the
poll might see `inputLufs` and `latency` from different processing
windows).

**Representative files:**

- `src/modules/AudioEngine/engine/telemetryAllocator.ts:131`
- `src/modules/AudioEngine/services/proofProcessor.ts:147-171`
- `src/modules/AudioEngine/services/bacteriaProcessor.ts:154-162`
- `src/modules/AudioEngine/services/grinderProcessor.ts:362-371`
- `src/modules/AudioEngine/services/glutenProcessor.ts:181-186`
- `src/modules/AudioEngine/services/scoringProcessor.ts:122-134`

**Needed:** Reserve one `Int32` field per slot as a generation counter.
The worklet writes `Atomics.add(generation, 1)` (odd → in-progress),
writes the floats, then `Atomics.add(generation, 1)` (even → committed).
The reader reads gen-before, reads floats, reads gen-after; if both even
and equal, the read is valid; otherwise retry. Pattern-of-record for
RT telemetry.

### 5. Recording WAV header overwrites first 44 bytes of audio

**Problem:** `recordingWorker.ts:35-45` opens OPFS with default
`createWritable()` (truncate) and appends raw PCM. On stop, opens with
`keepExistingData: true` and writes a 44-byte header at position 0 —
overwriting, not inserting. The first 11 PCM samples are destroyed,
producing a click at the start of every recording.

**Representative files:**

- `src/modules/AudioEngine/workers/recordingWorker.ts:35-45,83-122`

**Needed:** Reserve 44 bytes of header-placeholder at the START of the
file before the worker begins draining. Either: (a) on `init`, write 44
zero bytes via `opfsWritable.write(new ArrayBuffer(44))`; the drain
appends starting at byte 44; on stop, patch the header at position 0.
Or (b) write PCM to a temp file, then on stop construct the final WAV
file by writing header + reading temp + writing PCM in one stream.

### 6. Recording / GrandBoule heads are 32-bit and overflow

**Problem:** `_writeHead` is a 1-element `Int32Array`. After ~2³¹
samples (12 hours @ 48 kHz, less for higher rates), `Atomics.add` wraps
to negative. The recording worker reads `currentWrite − localReadHead`
and gets a large-negative value, treats it as "no available samples",
and silently stalls. GrandBoule's head wrap interaction with `(readHead
>>> 0) % ringFrames` produces a discontinuous index jump at the boundary
because `ringFrames` doesn't divide `2³²`.

**Representative files:**

- `src/modules/AudioEngine/services/recordingProcessor.ts:51-66`
- `src/modules/AudioEngine/workers/recordingWorker.ts:52-67`
- `src/modules/AudioEngine/services/grandBouleProcessor.ts:72-82`
- `src/modules/AudioEngine/workers/grandBouleEngineWorker.ts:104-122`

**Needed:** Two options. (a) Use a 64-bit head split across two Int32
words with `Atomics` discipline; the consumer reads both with retry
to avoid mid-write. (b) Reset the head to 0 (and force the consumer to
acknowledge) every N samples — say, when the head approaches `2³⁰`.
Document the constraint explicitly.

### 7. `audioEngine` is instantiated at module import time

**Problem:** `repositories/createWebAudioEngine.ts:600` exports
`audioEngine = createAudioEngine()`. The constructor allocates an
`AudioContext` and a `SharedArrayBuffer` immediately on import. Side
effects: (a) chrome warns about no-user-gesture; (b) tests share a
single AudioContext across cases without reset; (c) SAB allocation
fails outright if COOP+COEP aren't set, leaving the module-level
binding unusable.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:48,52,600`

**Needed:** Lazy-init pattern: replace the eager binding with
`getAudioEngine()` that creates the engine on first call. Tests that
need a fresh engine call a reset helper. The user-gesture handler
calls `getAudioEngine().resume()` for the live context.

### 8. Transport SAB reads are non-atomic; readers see torn / interleaved fields

**Problem:** `setTransportInfo` writes 7 Float64 fields sequentially
(`createWebAudioEngine.ts:362-369`). The Knead worklet reads
`view[0,1,5]` bare. A `process()` call interleaved with the main-
thread write can observe `tempo` from the new tick and `currentBeat`
from the previous, producing transient pitch-shift miscalculations
across transport changes.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:354-370`
- `src/modules/AudioEngine/services/kneadProcessor.ts:96-129`

**Needed:** Same generation-counter pattern as #4, or write a single
binary blob per tick (Float64 × 7 packed) into a SAB and rely on the
fact that the consumer reads the whole blob atomically (which JS does
not guarantee — so the generation counter is the right fix).

### 9. Track / master peak meter buffer races on read-modify-write

**Problem:** Worklet sets `_sab[0] = peak` if `peak > _sab[0]`. Main
thread reads `_sab[0]` then writes `_sab[0] = 0`. There are no
atomics, no compare-and-swap. A peak written between the main
thread's read and zero-write is silently dropped.

**Representative files:**

- `src/modules/AudioEngine/services/meteringProcessor.ts:51-53`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:236-238`
- `src/modules/AudioEngine/engine/TrackNode.ts:175-177`

**Needed:** Use `Atomics.exchange(intView, 0, 0)` on a Int32 view of
the same memory (the read-and-zero is atomic), with the worklet using
`Atomics.compareExchange` for the peak update (loop until written).
For Float32 you need a transmute via Int32 bit-casting. Or accept the
miss and document the tolerance — as long as the rate is high (60+ Hz)
the missed-peak rate is statistically tolerable.

### 10. Live-playback PDC is missing entirely

**Problem:** `getCompensationDelay` is wired into the offline render
path (`scheduleTrackClips.ts:128,358-359`) but **no `DelayNode` is
inserted into the live audio graph** for low-latency tracks. A track
with a 50 ms latency plugin (Bacteria, Grinder, Proof) plays 50 ms
later than a parallel track during live monitoring; the offline
render reports them aligned; the live mix is silently mis-aligned.

**Representative files:**

- `src/modules/AudioEngine/engine/TrackNode.ts:195-208` (route output —
  this is the natural insertion point for a DelayNode)
- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/getCompensationDelay.ts`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:185-200`

**Needed:** Insert a `DelayNode(ctx, { maxDelayTime: 1, delayTime:
compensationDelay })` between `analyserNode` and the track's output
destination during live playback. Update the delayTime when
`reportLatency` fires (the registry needs an observable / event).

### 11. Live MIDI input PDC misses controller latency

**Problem:** `webMidi/messageHandlers.ts:247` accounts for
`baseLatency + outputLatency + trackLatency` but not for the input
device's transport latency from physical key-press to
`MIDIInput.onmidimessage`. USB MIDI ≈ 1-3 ms, BT MIDI ≈ 5-25 ms.

**Representative files:**

- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts:241-250`

**Needed:** Add an `inputLatencyMs` field to the WebMIDI input store
(set by user calibration or device introspection), and include it in
`totalLatencySec`. Default to 2 ms for USB MIDI (typical) until the
user calibrates.

### 12. `setBypass` doesn't actually bypass any device

**Problem:** Bypass on Fermenter, GrandBoule, and Levain (and via the
WASM device registry, on others) flips a JS-side `bypassed` flag in
the factory closure that gates only `noteOn` posts. `noteOff` is
unguarded; the worklet keeps running and the engine produces audio
for held notes. UX expectation: bypass = silent.

**Representative files:**

- `src/modules/AudioEngine/engine/FermenterNode.ts:79-101`
- `src/modules/AudioEngine/engine/GrandBouleNode.ts:122-161`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:200-262` (Levain)

**Needed:** Either post a `bypass` message to the worklet (which
short-circuits to passthrough — the patterns from `KneadProcessor` and
`ProofChamberProcessor` are the template), or insert a `GainNode` ahead
of the worklet's output and ramp it to 0 on bypass.

### 13. `stopAllScheduled` floods Fermenter / Toaster with noteOff bursts

**Problem:** `repositories/createWebAudioEngine.ts:519-543` iterates
each Fermenter and posts 128 noteOff messages, plus 16 per Toaster
device. With 5 Fermenter tracks active that's 640 structured-clones
per stop. Audio thread CPU spikes on transport stop.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:519-543`

**Needed:** Add an `allNotesOff` message type to FermenterProcessor /
ToasterProcessor that triggers `inst.all_notes_off()` on the WASM
side. Levain already does this (line 539). Fermenter and Toaster
just need parity.

### 14. `Knead` outputs left channel into both stereo channels

**Problem:** `services/kneadProcessor.ts:151-159` pulls the left output
pointer from WASM, then `out0.set(wasmOutL)` and `out1.set(wasmOutL)`.
The right output pointer is never read. Every Knead-pitched track
plays as a mono signal panned dead-centre.

**Representative files:**

- `src/modules/AudioEngine/services/kneadProcessor.ts:151-159`

**Needed:** Add a `get_right_output_ptr()` to the WASM `KneadInstance`
binding (or use the existing `get_right_ptr` if exposed) and write it
into `out1` separately.

### 15. `externalLatencyRegistry` is never cleared on `resetGraph`

**Problem:** `repositories/createWebAudioEngine.ts:545-574` clears
trackNodes, busNodes, sendNodes, sidechainConnections, and
pendingDevicePromises. But the `externalLatencyRegistry` Map is a
process-wide singleton with no clear path. Stale device IDs survive
project switches and inflate `getMaxTrackLatency`, delaying every
new project's tracks.

**Representative files:**

- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/externalLatencyRegistry.ts:1`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:545-574`

**Needed:** Add `externalLatencyRegistry.clear()` (or move the clear
to a use case `resetExternalLatencies` invoked from `resetGraph`).

### 16. Telemetry slot exhaustion silently disables metering

**Problem:** `engine/telemetryAllocator.ts:122-128` returns `null` when
the 64-slot SAB is full. Callers (Bacteria/Gluten/Grinder/Proof/
ProofChamber/Scoring) handle null by skipping `init-sab`. The worklet
runs but never writes telemetry; the UI shows no metering. No user-
visible signal that the limit was hit.

**Representative files:**

- `src/modules/AudioEngine/engine/telemetryAllocator.ts:122-128`
- `src/modules/AudioEngine/engine/ProofNode.ts:71-122`
- (and analogous in Bacteria, Gluten, Grinder, ProofChamber,
  Scoring nodes)

**Needed:** Either raise MAX_SLOTS to a safe cap (e.g. 256 — 32 KB),
or surface a `notifyUser` warning when the slot count crosses 80 % of
capacity with guidance to reduce active plugins. The 64-slot cap was
chosen for SAB compactness but at 32 floats/slot the cost of growing
to 256 is one byte page (32 KB).

### 17. Telemetry slot leak on hot module reload

**Problem:** `telemetryAllocator` is a module-level singleton; HMR
re-creates it. The old SAB views handed to running worklets continue
to write into orphaned memory. Plugins loaded before the reload no
longer feed the new allocator's SAB.

**Representative files:**

- `src/modules/AudioEngine/engine/telemetryAllocator.ts:108-143`

**Needed:** Either persist the allocator across HMR via
`createHmrPersistentState` (see `repositories/audioRecorder/recording.ts:47`),
or expose a `reseat()` API that re-initialises every plugin's SAB
view. The HMR-persistent pattern is simpler.

### 18. AdjustmentBus reverb `Size` parameter maps to wet/dry mix

**Problem:** `engine/AdjustmentBusNode.ts:42-46`: `Size: 'rev-mix'`
is a misalignment between user-facing parameter ("Size" = room size)
and engine parameter (`rev-mix` = wet/dry blend). Damping is mapped
to `rev-lowcut` instead of high-frequency rolloff. The result: the
adjustment-layer reverb behaves audibly wrong.

**Representative files:**

- `src/modules/AudioEngine/engine/AdjustmentBusNode.ts:41-46`

**Needed:** Map `Size` to a real room-size param (probably
`rev-decay` or `rev-roomsize` if exposed by the reverb device).
Damping should map to `rev-highcut` or `rev-damping`.

### 19. `Faust` live MIDI scheduling uses `setTimeout`

**Problem:** Live MIDI input through a Faust polyphonic synth uses
`setTimeout(call, (time - ctx.currentTime) * 1000)` for keyOn / keyOff
scheduling. setTimeout has 4 ms minimum and arbitrary jitter. The
Faust device's offline-render path uses `OfflineAudioContext.suspend
→ resume`, which works for offline but stacks O(N) suspend / resume
transitions per render.

**Representative files:**

- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts:52-71`

**Needed:** For live: route Faust noteOn through the
AudioWorkletProcessor's port and queue the event to a
sample-frame sorted queue (the FermenterProcessor pattern). For
offline: batch the suspend points so one `suspend(time)` covers
multiple notes.

### 20. `audioBufferToWav` blocks main thread

**Problem:** `repositories/audioEncoders/wavEncoder.ts:57-80` does a
per-sample for-loop with `setTimeout(0)` yields every 32 768 samples.
Encode time floor is `≥ 4 ms × (totalSamples / 32 768)` because of
setTimeout's minimum delay — a 5-min stereo 44.1 kHz track adds 3.2 s
of pure sleep beyond the actual encoding time. UI freezes between
yields.

**Representative files:**

- `src/modules/AudioEngine/repositories/audioEncoders/wavEncoder.ts:57-80`
- `src/modules/AudioEngine/useCases/audioBufferToWav.ts:1-15` (use
  case forwarding)

**Needed:** Move the encode loop into a Worker. Pass the AudioBuffer's
channel data via `Transferable`. The encoder becomes
`postMessage('encode', {channels, sampleRate, bitDepth})` →
`postMessage('done', {wavBuffer})`. Same pattern for FLAC and MP3
encoders.

### 21. `audioBufferCache` LRU evicts active takes silently

**Problem:** `MAX_AUDIO_BUFFER_ENTRIES = 64` (line 39). A power-user
session with > 64 takes/imports/freezes triggers LRU eviction. The
evicted buffer is in IDB but **`audioBufferCache.get` is synchronous**
— a consumer that misses the cache gets `undefined` and treats the
take as silent. There's no automatic warm-from-IDB on get.

**Representative files:**

- `src/modules/AudioEngine/stores/audioBufferCache.ts:38-50,178-185,243-301`

**Needed:** Either (a) raise the cap dynamically based on per-buffer
size (track total bytes, evict only when over a threshold like
512 MB), or (b) add a `audioBufferCache.warm(ids: string[])`
async API that consumers call before they need the buffers. Existing
`restoreFromIdb` does this for the project-load path but not for
mid-session activity.

### 22. `audioBufferCache.exportBuffers` blocks main thread

**Problem:** `stores/audioBufferCache.ts:380-432` does base64 encoding
of every buffer's PCM data, yielding to the UI every 256 KB. For a
40-take project that's 230 MB of base64 with 900 yields × ≥ 4 ms =
≥ 14 s of UI freeze just from setTimeout floors.

**Representative files:**

- `src/modules/AudioEngine/stores/audioBufferCache.ts:11-23,380-432`

**Needed:** Move to a Worker with `Transferable` channel data. The
existing `String.fromCharCode.apply(null, Array.from(...))` should be
replaced with `TextDecoder('latin1').decode(bytes)` regardless.

### 23. `decodeAudioFile` swallows Tauri errors

**Problem:** `useCases/decodeAudioFile.ts:25-50`: a single `try {…}
catch {}` around the Tauri path silently falls through to the browser
path on any error — misconfiguration, missing native decoder, or
malformed `tempPath` write. Plus `tempPath = ${tempDir}/../cache/${file.name}`
does no path sanitisation.

**Representative files:**

- `src/modules/AudioEngine/useCases/decodeAudioFile.ts:25-50`

**Needed:** Log the Tauri error before falling back. Sanitise
`file.name` (strip `..`, normalise path separators) before
constructing `tempPath`. Distinguish "Tauri unavailable" (silent
fallback) from "Tauri decoder failed" (logger.warn, then fallback).

### 24. AGENTS.md `any` / `as` escapes in TrackNode and engine

**Problem:** `engine/TrackNode.ts:18,138,141,358,391` use `any` /
`as any`. AGENTS.md "TypeScript — soundness" forbids these escapes.

**Representative files:**

- `src/modules/AudioEngine/engine/TrackNode.ts:18,138,141,358,391`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:18`

**Needed:** Widen `setParam` signatures to accept the union actually
passed (`number | number[]`) and propagate through to wasm-bindgen.
Replace `Set<Promise<any>>` with `Set<Promise<unknown>>` consistently.
The `parseInt(name, 10) || 0` cast in TrackNode's native-plugin path
(line 358) is a separate concern — the param ID format should be
typed.

### 25. Module barrel exports types from useCases

**Problem:** `useCases/index.ts:18,21,37,89,94,131` re-export `type`
declarations across a module boundary. AGENTS.md "Use-case types
stay private". Compounded by the root `index.ts` re-exporting the
useCases barrel.

**Representative files:**

- `src/modules/AudioEngine/useCases/index.ts:18,21,37,89,94,131`
- `src/modules/AudioEngine/index.ts`

**Needed:** Move shared types to `models/` (cross-module-private;
duplicate per consumer per AGENTS.md "Model isolation") or remove
the type re-exports and have consumers derive types locally via
`ReturnType<typeof fn>`.

### 26. Tautological tests across the module

**Problem:** ~75 of 235 spec files (≈ 32 %) only assert a function
is defined and check `typeof`. No behavioural coverage.

**Representative files:**

- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/__tests__/getCompensationDelay.spec.ts`
- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/__tests__/reportLatency.spec.ts`
- `src/modules/AudioEngine/useCases/scheduling/__tests__/scheduleClick.spec.ts`
- `src/modules/AudioEngine/useCases/controlRoom/__tests__/*.spec.ts`
  (every spec)
- `src/modules/AudioEngine/useCases/engineAccess/__tests__/*.spec.ts`
- `src/modules/AudioEngine/useCases/nativeAiBridge/__tests__/*.spec.ts`
- (full list: `grep -l "should export"` returns 75 files)

**Needed:** Replace with behavioural tests. For pure helpers
(`getCompensationDelay`, `getStretchRateBetweenMarkers`), assert
output values for known inputs. For thin repositories
(`reportLatency`), assert the side effect (registry contains the
expected key/value). Stub the `audioEngine` and `trackStore`
dependencies via `vi.mock`.

### 27. `pendingDevicePromises.clear()` orphans in-flight loads

**Problem:** `repositories/createWebAudioEngine.ts:573` clears the
tracking set but the Promises themselves continue. When they resolve,
`onLoaded` swaps a placeholder in a now-disposed strip, instantiating
WASM that's immediately orphaned.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:545-574`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:265-797`

**Needed:** Each WASM device descriptor's load promise should accept
an `AbortSignal` keyed on the engine generation. On `resetGraph`, bump
the generation; in-flight loads check the signal before invoking
`onLoaded`. Practically: add an abort-controller to each
WasmDeviceCreateDeps.

### 28. `notifyUser` from inside the engine constructor

**Problem:** `repositories/createWebAudioEngine.ts:65-68` calls
`notifyUser(...)` directly when AudioContext fails. AGENTS.md
"Repositories Touch Metal" — repos do I/O, not UX dispatch.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:2,65-68`

**Needed:** Surface the failure as a typed error (`createEngineError(...)`)
and have the boot use case (`initializeAudioEngine.ts`) call
`notifyUser` on catch. The constructor should not have side effects
on UX state.

### 29. `Recording` start/stop race on worklet `init`

**Problem:** `recording.ts:172-186`. The recording-processor worklet
silently configures SAB on `init`. The main thread sends `start` to
the worklet immediately on worker `ready`. If worklet `port.onmessage`
hasn't run yet (queued behind the audio thread's current process()
call), `start` activates with `_active = true` but `_ring` /
`_writeHead` may still be null — the worklet writes to no-op for
the first few hundred ms.

**Representative files:**

- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:148-186`
- `src/modules/AudioEngine/services/recordingProcessor.ts:30-49`

**Needed:** Worklet posts a `ready` message on init completion.
Main-thread waits for both worker `ready` AND worklet `ready` before
sending `start`.

### 30. `onTelemetry` listener leak

**Problem:** Per-device `onMeterData` / `onTelemetry` adds callbacks
to a Set/single field in the factory closure with no removal API.
On device replacement (e.g. user changes the synth), the closure-
captured callback is leaked.

**Representative files:**

- `src/modules/AudioEngine/engine/FermenterNode.ts:102-104`
- `src/modules/AudioEngine/engine/ProofNode.ts:146-148`
- `src/modules/AudioEngine/engine/BacteriaNode.ts` (analogous)
- `src/modules/AudioEngine/engine/GlutenNode.ts` (analogous)
- `src/modules/AudioEngine/engine/GrinderNode.ts` (analogous)
- `src/modules/AudioEngine/engine/ScoringNode.ts` (analogous)

**Needed:** Return an unsubscribe function from `on*Telemetry`.
Callers track the unsubscribe and invoke it on device disposal.

### 31. `stopAudioRecording` returns before worker flush

**Problem:** `repositories/audioRecorder/recording.ts:205-213` calls
`cleanupNodesForSession` which disconnects the audio nodes, then sets
`isRecording: false`. The worker is left alive to flush OPFS and post
`wav` back. If the user immediately stops & starts a new recording,
the previous worker's `wav` may arrive after the new session has
started, with the wrong `trackId` cached in the closure.

**Representative files:**

- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:205-213`

**Needed:** `await` the wav reply (with timeout) before returning,
or queue the cleanup behind the `wav` handler. Track the worker
identity by `recordingSession.id` (a UUID) and reject mismatched
replies.

### 32. `AdjustmentLayerRuntime.reset` does not call `wireChain`

**Problem:** `reset` disposes buses and clears bookkeeping, then calls
`rerouteTrack` per affected track, but not `wireChain`. With
`busOrderByTrack` cleared, `getAdjustmentBusForTrack` returns null and
`routeOutput` correctly bypasses the chain — so this happens to work.
But `finalizeDisposal` does call `wireChain` after removing one
layer, leaving the symmetry inconsistent. Plus on per-layer
disposal, the previous chain end never explicitly disconnects from
the now-removed bus's input — relying on the bus's own
`dispose` to disconnect upstream.

**Representative files:**

- `src/modules/AudioEngine/engine/AdjustmentLayerRuntime.ts:140-150,210-225`

**Needed:** Document the invariant: `wireChain(trackId)` must be
called whenever `busOrderByTrack[trackId]` changes. Or simplify by
folding `wireChain` into `routeOutput` so re-route always re-wires.

### 33. `pre-existing` Fermenter `setParam` array branch is type-unsafe

**Problem:** `engine/FermenterNode.ts:91-95` accepts `value: number |
number[]` and posts via `port.postMessage({ type: 'param', name,
value, sampleFrame })`. The worklet's `FermenterMsg` declares
`param.value: number`. The array branch lies to the type system; the
WASM `inst.set_param` call expects `f32`.

**Representative files:**

- `src/modules/AudioEngine/engine/FermenterNode.ts:91-95`
- `src/modules/AudioEngine/services/fermenterProcessor.ts:46-47,135-138`

**Needed:** Either widen the worklet's `param` message to accept
arrays (introduce a separate `tuningTable` message), or split the
node API into `setParam(name, value: number)` + `setTuningTable(table:
number[])`. The latter aligns with the existing
`registerTuningTable` use-case in `TrackNode`.

### 34. `processFrames = Math.min(frames, 4096)` cap silently truncates

**Problem:** `services/levainProcessor.ts:265,277` caps process frames
at 4 096 but writes only `processFrames` to `out0`. Today the render
quantum is 128, so frames > 4 096 cannot occur — but if a future
spec change raises it, this code corrupts output silently.

**Representative files:**

- `src/modules/AudioEngine/services/levainProcessor.ts:265,277`

**Needed:** Either (a) loop within process() to cover all frames in
chunks of 4 096, or (b) match Grinder's pattern: passthrough on
oversize and `logger.warn` from the main thread.

### 35. WAV / FLAC / MP3 encoders use the main thread

**Problem:** All three encoders (`audioBufferToWav.ts`,
`audioBufferToFlac.ts`, `audioBufferToMp3.ts`) run on the main thread.
The 16-bit dither is also single-tap TPDF without noise shaping.

**Representative files:**

- `src/modules/AudioEngine/repositories/audioEncoders/wavEncoder.ts`
- `src/modules/AudioEngine/repositories/audioEncoders/flacEncoder.ts`
  (not opened — same shape suspected)
- `src/modules/AudioEngine/repositories/audioEncoders/mp3Encoder.ts`
  (not opened — same shape suspected)

**Needed:** Move all three to one shared encode Worker with
`Transferable` channel data. Optionally: switch to a noise-shaped
dither for 16-bit.

### 36. `loadAttackClip` double-copies `Float32Array`

**Problem:** `engine/GrandBouleNode.ts:152-154` copies samples via
`new Float32Array(samples)` then `postMessage` structured-clones the
copy again. Two copies of the (potentially many-MB) attack samples
per call.

**Representative files:**

- `src/modules/AudioEngine/engine/GrandBouleNode.ts:152-155`

**Needed:** Transfer the buffer:
`engineWorker.postMessage({ type: 'loadAttackClip', key, samples }, [samples.buffer])`.
The caller must understand the buffer is detached after the call —
add a JSDoc note.

### 37. Faust Faust device's `setParam` swallows error context

**Problem:** `repositories/faustDeviceFactory.ts:78-85`. A failed
`setParamValue` is logged but the failure mode is opaque to the
calling automation system — the param state in the store is now
out-of-sync with the engine.

**Representative files:**

- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts:78-85`

**Needed:** Either log with the resolved param address + the original
caller name, or surface the error to the call site via a return
value. Combine with an automation rollback strategy if the engine
rejects the value.

### 38. `Number.isFinite(value)` guard incompatible with array values

**Problem:** `engine/ProofNode.ts:131-135` (and similar):
`if (!bypassed && Number.isFinite(value))` is the param guard, but
`Fermenter` sends arrays through this path. `isFinite(array)` is
false → array-valued params (tuning table) are silently dropped on
ProofNode's path.

**Representative files:**

- `src/modules/AudioEngine/engine/ProofNode.ts:131-135`

**Needed:** Define which params accept arrays explicitly. For numeric
params, keep the `isFinite` guard; for array params, route through a
separate API.

### 39. `webMidi/state.ts` HMR leak

**Problem:** Module-level `_midiAccess`, `_activeInput`,
`_targetTrackId`, `_tauriEventUnlisten`, `activeNotes`, and
`channelToNote` are not HMR-persistent. Hot-reload during dev leaves
duplicate MIDI handlers wired to the previous module instance.

**Representative files:**

- `src/modules/AudioEngine/repositories/webMidi/state.ts:13-18,39-40`

**Needed:** Wrap each in `createHmrPersistentState` (the recording
module already uses this pattern: `repositories/audioRecorder/recording.ts:47`).

### 40. `LinkStatus` snake_case field violates frontend convention

**Problem:** `repositories/linkBridge/helpers.ts:13`: `num_peers:
number`. The TS frontend uses camelCase per the rest of the codebase
(`numberOfChannels`, `currentTime`). The snake_case is inherited from
the Tauri serde wire but should be transformed at the boundary.

**Representative files:**

- `src/modules/AudioEngine/repositories/linkBridge/helpers.ts:7-14`

**Needed:** Rename `num_peers` to `numPeers` in the TS type;
transform in the Tauri invocation wrapper (or annotate the Rust
struct with `#[serde(rename = "numPeers")]`).

### 41. Master peak meter is structurally unwired and silently returns 0

**Problem:** `repositories/createWebAudioEngine.ts:62` allocates
`masterMeterBuffer = new Float32Array(this.masterAnalyser.frequencyBinCount)`
— a non-shared Float32Array sized to the Analyser's `frequencyBinCount`
(128). `getMasterPeakLevel()` (line 236) reads `masterMeterBuffer[0]`,
zeroes it, and returns the value — but **nothing populates this buffer**.
The class declares `masterMeterNode: AudioWorkletNode | NoopMeterNode`
(line 29) but the live (non-fallback) constructor never instantiates a
metering-processor for the master, never wires up a worklet, and never
calls `getFloatTimeDomainData(this.masterAnalyser, this.masterMeterBuffer)`.
The `setupNoopContext` branch (lines 81-92) creates a NoopMeterNode but
also writes nothing to `masterMeterBuffer`. End result: the master
peak meter UI shows zero forever.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:29,62,85-92,232-238`

**Needed:** Either (a) instantiate a real `metering-processor`
AudioWorkletNode for the master path the same way `TrackNode` does
(line 62-67 of TrackNode.ts), with a 4-byte SAB and an init
postMessage; (b) replace the Float32Array allocation with a call into
`masterAnalyser.getFloatTimeDomainData(buffer)` per `getMasterPeakLevel`
call (slow but works). The current half-state where the buffer
exists but no producer feeds it is the worst of both worlds.

### 42. PDC is applied to audio clips but NOT to MIDI events in offline render

**Problem:** `useCases/offlineRender/scheduleTrackClips.ts:268-272`
schedules MIDI note times via `beatToSeconds(noteAbsStart, …)` with
no `+ compensationDelay`. Audio clip iteration adds compensation at
line 358-359. So a project with a MIDI track on a low-latency synth
and an audio clip on a high-latency plugin renders them with
**inconsistent** compensation: audio clips are delayed (correct)
but MIDI synth notes fire on the uncompensated grid. The offline
render UI claims sample-accurate latency compensation; the rendered
WAV proves otherwise.

**Representative files:**

- `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts:268-272,358-359`

**Needed:** Apply `compensationDelay` symmetrically to both branches.
For MIDI events that drive an `instrumentControls` worklet, push the
`workletEvents.push({time: startTime + compensationDelay, …})` so
the suspend points are aligned. For Faust / drum kit / synth
schedules that pass through `scheduleNoteOffline`, add
`compensationDelay` to the start time the same way the audio path
does.

### 43. 8 of 12 plugins fail to report any latency

**Problem:** `engine/wasmDeviceRegistry.ts` only wires `reportLatency`
into Bacteria, Gluten, Grinder, and Proof descriptors (lines 327, 370,
376, 437, 446, 507, 513). The remaining 8 plugin descriptors —
Knead, ProofChamber, Levain, Toaster, Fermenter, Faust, Scoring,
GrandBoule — do not call `reportLatency` even once. Each has
non-zero latency:
- GrandBoule renders `BLOCK_SIZE * 6 = 768 samples ≈ 16 ms` ahead
  in `workers/grandBouleEngineWorker.ts:34`.
- ProofChamber exposes a Pre-Delay parameter
  (`engine/AdjustmentBusNode.ts:43`).
- Knead's pitch-shift uses block-size overlap-add (≥ 128 samples).
- Toaster has transient-shaper lookahead.
`getMaxTrackLatency()` therefore under-estimates whenever any of
these plugins sits on the longest path; the offline scheduler
delays low-latency tracks by less than required, producing
silent misalignment.

**Representative files:**

- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:265-298, 130-188, 70-125, 553-590, 592-666, 668-734, 736-797`

**Needed:** Each WASM plugin should expose `get_latency_samples()` (the
Rust pattern is already used in Bacteria, Gluten, Grinder, Proof).
The descriptor reads it from the worklet's `ready` reply and
forwards `reportLatency(deviceId, latency / sampleRate * 1000)`.
For GrandBoule, the engine worker's `TARGET_AHEAD` is the latency
floor — report it on `init` ack.

### 44. Knead's `tuning-table` parameter is silently dropped

**Problem:** `services/kneadProcessor.ts:53-56` only handles `param`
messages where `name === 'shift_semitones'`. Any other param name
silently falls through. **`engine/TrackNode.ts:138` calls
`dn.kneadControls.setParam('tuning-table', frequencies as any)`** —
that call is a no-op for Knead-equipped tracks. The `as any`
suppression makes the type system silent on the bug.

**Representative files:**

- `src/modules/AudioEngine/services/kneadProcessor.ts:46-65`
- `src/modules/AudioEngine/engine/TrackNode.ts:135-144`

**Needed:** Either (a) extend the worklet's `param` handler to forward
arbitrary names to `inst.set_param(name, value)` like every other
plugin, or (b) split tuning-table into a dedicated `tuning-table`
message type that the worklet forwards to `inst.set_tuning_table`
(if Rust exposes it). Drop the `as any`.

### 45. Knead's `process()` allocates a closure per block via `Array.find`

**Problem:** `services/kneadProcessor.ts:106` uses `for (const clipId
in this._clips)` (prototype-walking — same concern as audit #19),
and lines 119-121 use `activeClip.blobs.find((b) => …)`. `Array.prototype.find`
allocates a new closure scope each call. With `isPlaying` true the
hot path runs every render quantum (~375 Hz at 48 kHz / 128 frames
= 375 closures/sec/track).

**Representative files:**

- `src/modules/AudioEngine/services/kneadProcessor.ts:104-128`

**Needed:** Replace `for…in` with `Object.keys(this._clips)` cached
once on `update-state`. Replace `find` with a manual indexed loop
(no closure). Consider precomputing a sorted array of `(startBeat,
endBeat, blobs)` tuples so the active-clip lookup becomes a
binary search.

### 46. AudioEngine has no root `index.ts`; cross-module imports bypass the contract

**Problem:** `find src/modules/AudioEngine -maxdepth 1 -name "index.ts"`
returns nothing. AGENTS.md "Contract Boundaries": cross-module
imports MUST only target the destination module's root `index.ts`.
External consumers reach into `#/modules/AudioEngine/useCases`,
`#/modules/AudioEngine/events`, and even deep paths like
`#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip`
(deep import in tests).

**Representative files:**

- (missing) `src/modules/AudioEngine/index.ts`
- `app/bootstrap.ts:27`
- `modules/Toaster/useCases/__tests__/createDrumTrackStack.spec.ts:7`
- `modules/Toaster/useCases/__tests__/triggerPad.spec.ts:5`
- `modules/Grinder/useCases/grinderParamBridge/grinderParamBridgeDependencies.ts:2`
- `modules/GrandBoule/useCases/createGrandBouleTrack.ts:12`

**Needed:** Add `src/modules/AudioEngine/index.ts` that re-exports
the documented external surface (useCases values, events types,
stores). Tighten `pnpm deps:validate` to ban deep imports of
`#/modules/AudioEngine/...` paths. Migrate the 100+ external
import sites in batches.

### 47. AdjustmentLayerRuntime.reset() bypasses fade-out grace

**Problem:** `engine/AdjustmentLayerRuntime.ts:210-225` clears any
pending `disposalTimer` and immediately calls `live.bus.dispose()` —
skipping the `FADE_OUT_GRACE_MS = 300 ms` fade-out used in
`applyTick` (line 197). The bus's `wetGain` / `dryGain` are still
at last-applied values when `dispose()` runs, so the audio path
gets cut hard. Audible click on every project switch / reset /
adjustment-layer purge.

**Representative files:**

- `src/modules/AudioEngine/engine/AdjustmentLayerRuntime.ts:140-150,210-225`

**Needed:** In `reset`, ramp `wet/dryGain.gain.setTargetAtTime(0, …)`
first, then schedule the dispose batch with the same FADE_OUT_GRACE_MS
delay. Or accept that reset is destructive and emit a transient
crossfade gain at the master path.

### 48. `wasmBinaryCache` is module-level Map that survives HMR

**Problem:** `engine/workletInitShared.ts:60`: `const wasmBinaryCache =
new Map<string, Promise<ArrayBuffer>>()`. Not wrapped in
`createHmrPersistentState`. Survives HMR, holding onto WASM bytes
indefinitely. Coupled with GrandBoule's separate
`cachedGrandBouleWasm: ArrayBuffer | null` (`engine/GrandBouleNode.ts:32`),
each HMR doubles the cached WASM footprint. Long dev sessions
accumulate 100+ MB of orphaned WASM bytes.

**Representative files:**

- `src/modules/AudioEngine/engine/workletInitShared.ts:32, 60`
- `src/modules/AudioEngine/engine/GrandBouleNode.ts:32-44`

**Needed:** Wrap `wasmBinaryCache` and `cachedGrandBouleWasm` in
`createHmrPersistentState` (the recording module's pattern at
`repositories/audioRecorder/recording.ts:47`). Or accept the
trade-off and add a debug-only `clearWasmCache()` invoked on
HMR — but persistence is the right default.

### 49. Recording-processor `(head + index) % ringSize` per-sample modulo

**Problem:** `services/recordingProcessor.ts:62-64` does
`for (let index = 0; index < input.length; index++) {
this._ring[(head + index) % ringSize] = input[index] ?? 0; }` —
128 modulo ops per render quantum, plus 128 nullish-coalesce
branches. The correct allocation-free pattern is to precompute the
wrap-point and issue two `subarray + .set` writes covering the
linear and wrapped chunks.

**Representative files:**

- `src/modules/AudioEngine/services/recordingProcessor.ts:51-66`

**Needed:** ```
const offset = head % ringSize;
const firstChunk = Math.min(input.length, ringSize - offset);
this._ring.set(input.subarray(0, firstChunk), offset);
const second = input.length - firstChunk;
if (second > 0) { this._ring.set(input.subarray(firstChunk), 0); }
```
Then `Atomics.add(this._writeHead, 0, input.length)`. Same
correctness, ~30× faster.

### 50. OPFS recording temp file leaks when worker terminated mid-flush

**Problem:** `repositories/audioRecorder/recording.ts:240-247`:
`terminateWorker(session)` is called from `decodeAndDeliver` AFTER
`ctx.decodeAudioData` succeeds. The wav buffer is delivered to
main via `self.postMessage({type:'wav', buffer}, [arrayBuffer])`
(`workers/recordingWorker.ts:128`), and the temp file is removed
in the same `stopWorker` chain (lines 130-136), AFTER the post.
If main calls `terminateWorker` between the postMessage and the
removeEntry, the temp file `rec-tmp-<timestamp>.pcm` survives
in OPFS forever. Same risk via `recordingWorker.onerror` — the
cleanup branch does not invoke OPFS file removal.

**Representative files:**

- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:181-203, 240-247`
- `src/modules/AudioEngine/workers/recordingWorker.ts:124-138`

**Needed:** Move OPFS cleanup BEFORE the `postMessage('wav')` so
the temp file is gone before any race window opens. Add a
periodic OPFS sweep on app startup that removes
`rec-tmp-*.pcm` files older than 1 hour (defensive against
existing leaks).

### 51. `acquireSharedMediaStream` lacks Promise coalescing

**Problem:** `repositories/audioRecorder/recording.ts:62-68`. First
caller starts `getUserMedia`; second arrives during the first's
`await`, sees `sharedStreamState.stream === null`, and starts
a SECOND `getUserMedia`. Both eventually resolve. `usageCount++`
twice. Result: count = 2, but two physical streams; the
`sharedStreamState.stream = await getUserMedia()` overwrites the
first; the first stream's tracks are orphaned (mic light stays
on). On release, count goes 2→1→0 and the WINNER is stopped on
the second release; the LOSER is never `.stop()`ed.

**Representative files:**

- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:54-80`

**Needed:** Cache the in-flight Promise itself. Pseudo:
```
if (!sharedStreamState.streamPromise) {
  sharedStreamState.streamPromise = navigator.mediaDevices
    .getUserMedia(…).then(s => { sharedStreamState.stream = s; return s; });
}
const stream = await sharedStreamState.streamPromise;
sharedStreamState.usageCount++;
```

### 52. `recordingProcessor` lacks an `init`-completion ack — start race

**Problem:** `services/recordingProcessor.ts:30-37`. The `init` handler
runs synchronously to set `_writeHead` / `_ring`, but it runs on the
audio thread and may queue behind a long `process()` call. Main
sends `init` then `start` to the worklet
(`recording.ts:148, 175`). If the audio thread is busy, the worklet
processes `start` BEFORE `init`: `_active = true` while `_ring`
is null, and `process()` early-returns (line 52-54). First audio
is silently dropped until the next `port.onmessage` cycle. The
audit's issue #29 framed this as a worker-vs-worklet race; the
actual race is **inside** the worklet's own message ordering.

**Representative files:**

- `src/modules/AudioEngine/services/recordingProcessor.ts:30-37`
- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:148, 173-186`

**Needed:** In the worklet's `init` handler, post
`this.port.postMessage({type:'ready-init'})` after assignments.
On the main thread, await both worker `ready` AND worklet
`ready-init` before sending `start`.

### 53. SAB ring writes on `recordingProcessor` lack a release fence (cf. #3)

**Problem:** `services/recordingProcessor.ts:60-65` does `Atomics.load`
of `_writeHead`, bare ring writes, then `Atomics.add(_writeHead, 0,
input.length)`. The consumer
(`workers/recordingWorker.ts:52`) reads `currentWrite` via `Atomics.load`
and then bare-reads `ring[(localReadHead + index) % ringSize]`. The
non-atomic typed-array writes and reads can be re-ordered around
the `Atomics.{load,add}` pair. The OPFS drain runs 50 ms behind so
the race window is mostly papered over, but a wraparound at exactly
the moment the producer writes new samples could deliver stale data.

**Representative files:**

- `src/modules/AudioEngine/services/recordingProcessor.ts:60-66`
- `src/modules/AudioEngine/workers/recordingWorker.ts:47-67`

**Needed:** Same pattern as audit issue #3 — generation counter on the
ring, or `Atomics.exchange` on a sentinel that orders the bare
writes/reads.

### 54. `Grinder.setBypass` posts a `param` message that triggers a useless latency-changed broadcast

**Problem:** `engine/GrinderNode.ts:128-130` posts
`{type:'param', name:'bypass', value: 1|0}`. The worklet handler at
`services/grinderProcessor.ts:247-254` does
`oldLatency = inst.get_latency_samples(); inst.set_param('bypass',
value); newLatency = inst.get_latency_samples()`; if they differ, it
posts `latency-changed`. Bypass should not change latency, but the
comparison runs anyway. Each bypass toggle costs two WASM calls plus
an unconditional postMessage round-trip — bypass-as-passthrough on
this code path is more expensive than running the DSP.

**Representative files:**

- `src/modules/AudioEngine/engine/GrinderNode.ts:128-130`
- `src/modules/AudioEngine/services/grinderProcessor.ts:247-262`

**Needed:** Add a dedicated `bypass` message type in the worklet
that short-circuits the latency comparison; or have the WASM
`bypass` param always return the same latency (a known constant)
so the comparison always reports unchanged.

### 55. Bacteria/Grinder telemetry uses `requestAnimationFrame` — stops in background tabs

**Problem:** `engine/BacteriaNode.ts:122,124` and
`engine/GrinderNode.ts:153,155` both use `requestAnimationFrame` for
the SAB poll loop. `requestAnimationFrame` callbacks pause when the
tab is backgrounded. Telemetry stops; on re-foreground, the meters
resume from whatever value the SAB held — which may be stale by
seconds. Plus: a project being rendered offline while the tab is
backgrounded sees no telemetry-driven `reportLatency` updates from
Bacteria/Grinder, breaking PDC for that render.

**Representative files:**

- `src/modules/AudioEngine/engine/BacteriaNode.ts:101-125`
- `src/modules/AudioEngine/engine/GrinderNode.ts:131-156`

**Needed:** Replace the rAF poll with `setInterval(…, 16)` (the
pattern Proof and Gluten already use). Or, for backgrounded
correctness, gate the latency-reporting callback on a
non-rAF channel (e.g., the worklet posts `latency-changed`
directly, which is already the case for Grinder/Bacteria —
verify the rAF path is not the only `reportLatency` source).

---

## Open questions

- [ ] Is the live-playback PDC absent by design (e.g. relying on the
      WebAudio scheduler's intrinsic latency) or is it a known gap awaiting
      `DelayNode` insertion? (Affects whether issue #10 is a bug or a
      "do not promote" item.)
- [ ] Are the AudioWorklet `process()` `Float32Array` views actually
      observed to allocate at runtime, or does V8's escape analysis
      stack-allocate them? A microbenchmark with `--allocation-tracking`
      would settle whether issue #1 is theoretical or measured.
- [ ] What is the intended HMR behaviour for the AudioContext singleton
      and the per-plugin Worklets / Workers? Should HMR re-instantiate
      everything (current behaviour, leaks worklets) or persist
      everything (the recorder pattern)?
- [ ] Is `Recording.acquireSharedMediaStream` ever called from > 1
      tab in a multi-tab project (hosted through OPFS)? If so, the
      `usageCount` race (#52 in findings, not surfaced as an open
      issue) becomes user-visible.
- [ ] `transportSAB` is read by which worklets specifically? Knead is
      the documented consumer; are other plugins (Bacteria's Lorenz LFO?)
      reading transport beat without atomic discipline? **Adversarial
      review answer:** only Knead reads `transportSAB`; verified by
      `grep -rn "transportSAB\|transport_view\|view\["
      src/modules/AudioEngine/services/`. Other plugins receive
      transport via discrete messages or do not need it. Open question
      can be closed.

---

## Risks

- **Silent audio corruption.** Issues #3, #4, #9, #53 — SAB races
  without fences are infrequent enough to escape casual testing but
  produce occasional clicks, lost peaks, and wrong telemetry readings
  under load. In a DAW context, "occasional" means "every time the
  user pushes the CPU near the limit", which is exactly when they
  need correctness.
- **Master peak meter is a lie.** Open issue #41 / finding #63 —
  the master meter UI never shows signal because nothing populates
  the buffer the read function reads. Users mixing through the
  master fader cannot see clipping. This is a hidden P1 the audit
  originally hid inside #9.
- **Offline render mis-aligns MIDI vs audio.** Open issue #42 /
  finding #64 — every project rendered to disk has a different
  alignment than its live playback (in opposite directions: live has
  no PDC at all per issue #13; offline has PDC for audio but not
  MIDI). The DAW's "what you hear" promise is broken in both
  directions.
- **PDC is built on incomplete latency reporting.** Open issue #43 /
  finding #65 — only 4 of 12 plugins call `reportLatency`. The PDC
  system computes `getMaxTrackLatency()` from a value that is wrong
  for two-thirds of the plugin catalogue. Even fixing the live-PDC
  gap (issue #13) won't help unless Knead, ProofChamber, GrandBoule,
  Levain, Toaster, Fermenter, Faust, and Scoring start reporting.
- **Knead silently ignores tuning tables.** Open issue #44 / finding
  #69 — `registerTuningTable` is a no-op for Knead-equipped tracks
  because the worklet only handles `shift_semitones`. Microtonal /
  alt-tuning workflows do not work on Knead.
- **Recordings start with a click on every take.** Issue #5 — the WAV
  header overwrites the first 44 bytes of audio. Audible discontinuity
  on every recorded take, attributable to a 5-line worker bug.
- **Knead pitch editing collapses to mono.** Issue #14 — every
  Knead-pitched clip plays as centre-panned mono regardless of the
  source stereo image. User-visible.
- **Long recording sessions stall silently after 12 hours.** Issue #6 —
  Int32 overflow in the writeHead. Few users will hit it; those that do
  (live tracking session, long set recording) will lose data without
  warning.
- **PDC is broken in two complementary ways.** Issues #10, #11 —
  live-playback compensation doesn't exist (only offline render
  compensates) and live MIDI input compensation misses the controller
  latency. A DAW that claims sample-accurate latency compensation
  cannot be marketed with these gaps.
- **Bypass doesn't bypass.** Issue #12 — fundamental UX expectation
  violation. Devices keep producing audio when bypassed; held notes
  don't release; new noteOns during bypass leak into the engine queue.
- **Plugin slot exhaustion silently disables metering.** Issue #16 —
  power users with > 64 active metered devices see flat meters with no
  warning. The 64 cap is generous for casual use, low for production
  mixing sessions.
- **UI freezes during export and project save.** Issues #20, #22 —
  WAV encoding and base64 export both block the main thread for
  multi-second windows on long sessions. Browser may "page unresponsive"
  the user.
- **Test coverage is theatre.** Issue #26 — 75 spec files exist but
  prove only that exports are defined. The actual coverage is much
  smaller than file count suggests. Refactors of the audited files
  (PDC, WAV header fix, atomic disciplines) will not be caught by
  the existing tests.
- **Module-level `audioEngine` singleton.** Issue #7 — instantiates
  `AudioContext` at import time. Browser warnings + cross-test state
  pollution + SAB-allocation failures with no recovery path.
- **WASM-backed plugin loads orphaned on project switch.** Issue #27
  — pendingDevicePromises clear breaks the load tracking, but the
  underlying load continues. Rapid project switching during
  plugin-heavy projects produces orphaned ~10 MB+ WASM instances.

---

## Suggested approaches

- **Wire the master peak meter — no architecture, just instantiate
  the worklet** (open issue #41). One AudioWorkletNode, one 4-byte
  SAB, one init message. Restores a UI signal that's currently dead.
- **Land the Knead mono bug, the WAV header bug, the Knead
  tuning-table no-op, and the Fermenter / Toaster all-notes-off
  batching first** (issues #14, #5, #44, #13). They are mechanical,
  audible, and 1-2 line fixes. Each closes a known quality gap with
  no architectural cost.
- **Apply PDC compensation symmetrically to MIDI and audio in the
  offline render** (open issue #42). 1-line fix at
  `scheduleTrackClips.ts:268-272` adds `+ compensationDelay` to the
  MIDI path; the rendered output instantly aligns with what the UI
  promises.
- **Wire latency reporting for the 8 silent plugins** (open issue
  #43). Each plugin descriptor needs `reportLatency(deviceId, …)` on
  ready. For Rust-backed plugins, expose `get_latency_samples()`. For
  GrandBoule, the `TARGET_AHEAD` constant in the engine worker is the
  fixed floor.
- **Add atomic discipline (generation counters) to the telemetry SAB
  and the meter SAB next** (issues #4, #9). The pattern is reusable
  across plugins; once the helper is in place, applying it to every
  worklet is mechanical.
- **Ring-buffer fences for the GrandBoule and Recording rings**
  (issues #3, #53). The simplest correct fix is to use
  `Atomics.exchange` on a sentinel value that the consumer treats as
  a release fence.
- **Add an AudioEngine root `index.ts`** (open issue #46) and
  tighten `pnpm deps:validate` to ban `#/modules/AudioEngine/...`
  deep imports. Without the root barrel, every other AGENTS.md
  contract rule is unenforceable for this module.
- **PDC live-playback delay** (issue #10) and input-controller
  latency (issue #11). The DelayNode insertion is straightforward; the
  controller-latency calibration UX is a feature spec.
- **Refactor `setBypass` to actually bypass** (issue #12). Add a
  `bypass` message type to every worklet that doesn't have one;
  short-circuit to passthrough; mute the device's gainNode while
  bypassed to avoid stuck notes.
- **Lazy-init the engine singleton** (issue #7). Replace
  `export const audioEngine = createAudioEngine()` with
  `export function getAudioEngine()` that creates on first call.
  Update all import sites (mechanical via TypeScript compile errors).
- **Move encoders to a Worker** (issues #20, #22, #35). One shared
  encode Worker can host WAV/FLAC/MP3 + base64 paths. Use
  `Transferable` for AudioBuffer channel data.
- **Replace the tautological tests with behavioural specs** (issue
  #26). The 75 affected files are uniform; a sweep can replace
  `expect(fn).toBeDefined()` with one or two real assertions per
  file.
- **AGENTS.md compliance pass** (issues #24, #25, #28, #40) as a
  mechanical follow-up — small per-file edits, no architectural cost.

---

## Recommendation

> Adversarially-revised recommendation. The original recommendation
> still stands as a starting point but fails to surface the master
> meter / Knead tuning-table / MIDI-PDC bugs that the audit's old
> Findings section under-weighted.

Start with the four 1-line fixes in this order:

1. **Open issue #41 (master peak meter unwired)** — instantiate a
   `metering-processor` for the master path, wire it the same way
   `TrackNode` does. Restores a UI signal users rely on for clipping
   detection.
2. **Issue #14 (Knead mono collapse)** — fetch right output pointer
   in `kneadProcessor.ts` and write to `out1` separately.
3. **Issue #5 (recording WAV header overwrite)** — reserve 44 bytes
   of header placeholder before draining starts.
4. **Open issue #42 (offline-render MIDI PDC missing)** — add
   `+ compensationDelay` to the MIDI scheduling path. 1-line fix.

Each is a standalone commit with a regression test. The first two are
visible-from-the-UI bugs; the third is an audible click; the fourth
is a measurable timing offset between MIDI and audio in any rendered
WAV.

Then take **open issue #44 (Knead tuning-table no-op)** because it is
adjacent to #14's WASM file and a coherent "fix Knead end-to-end"
commit.

After that, the next session can decide between the "correctness
pass" (issues #3, #4, #8, #9, #10, #11, #12, #13, #43, #53) — all
audio-thread / latency-correctness items — and the "architecture /
testing pass" (issues #7, #20, #22, #25, #26, #27, #35, #46). The
two passes are independent.

---

## Resolved

_No issues resolved yet._

**Adversarial review notes (not resolutions):**

- Issue #5 mono vs stereo: confirmed mono Float32 (per WAV header at
  `recordingWorker.ts:113`), 11 samples destroyed, ~0.23 ms at 48 kHz.
  Audit math was correct; severity stands.
- Issue #9 "master peak race": **partially incorrect**. The master
  meter path is structurally unwired — see new finding #63 / open
  issue #41. The race only applies to per-track meters.
- Issue #29 "Recording start race": **partially incorrect**. The race
  is inside the worklet's own message ordering, not between worker
  and worklet. See new open issue #52.
- Open question on `transportSAB` consumers: **closed** —
  Knead is the only reader; verified by grep.
