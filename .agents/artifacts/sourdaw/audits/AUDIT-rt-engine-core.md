---
type: audit
id: AUDIT-rt-engine-core
title: Real-time engine core audit
scope: Browser-side real-time audio engine — AudioWorklet processors, telemetry SAB, PDC/latency compensation, scheduling, resume/gesture, single-context discipline
baseline: origin/main @ 117e4bbef0a4875aaed31706f9e5a6b47578bf0c
date: 2026-07-23
method: sus-audit (observe, prove, prescribe nothing) + web-audio-engine skill invariants
---

# Real-time engine core audit

Audit of Sourdaw's browser-side real-time audio engine against a first-class RT-audio
golden standard. **AUDIT ONLY — no fixes.** Every finding is anchored to `file:line` on
the frozen baseline above. Paths are worktree-relative to the repo root.

Scope excludes: Rust/native CPAL internals (boundary-level only), the Transport MIDI tick
architecture (documented in `AUDIT-midi-handling.md §strengths` — not re-litigated here),
offline export determinism (`AUDIT` offline-export lineage), and native-plugin host isolation
mechanics beyond the shared RT rules.

---

## Golden Standard (citations)

The audio render thread (`AudioWorkletProcessor.process`) runs under a hard deadline —
one 128-sample quantum is ~2.9 ms at 44.1 kHz / ~2.67 ms at 48 kHz — and a single missed
deadline is an audible dropout. The established rules:

1. **No allocation, locks, blocking, or unbounded work in the audio callback.** The memory
   allocator must never be invoked from the render thread; pre-allocate in another context.
   Allocating objects (even zero-copy `Float32Array` views) inside `process()` feeds the GC,
   "a silent killer in the high-priority world of real-time audio."
   — Ross Bencina, *Real-time audio programming 101: time waits for nothing*
   (http://www.rossbencina.com/code/real-time-audio-programming-101-time-waits-for-nothing);
   Loke.dev, *Stop Allocating Inside the AudioWorkletProcessor*
   (https://loke.dev/blog/stop-allocating-inside-audioworkletprocessor).

2. **Cross-thread telemetry belongs on SharedArrayBuffer + Atomics, not the MessagePort.**
   The port's structured-clone messaging is "suboptimal for real-time audio processing
   because of repetitive memory allocation and messaging latency"; allocate shared memory up
   front and use Atomics for lock-free, torn-read-free exchange (seqlock for multi-field
   snapshots). — Chrome for Developers, *Audio Worklet Design Pattern*
   (https://developer.chrome.com/blog/audio-worklet-design-pattern/); W3C Web Audio API
   issue #1327 *hard real-time guarantee for AudioWorklets*
   (https://github.com/WebAudio/web-audio-api/issues/1327).

3. **Schedule with a worker-thread clock + look-ahead window.** `setTimeout`/`setInterval`
   on the main thread skews 10 ms+ under layout/GC/XHR; use the audio hardware clock for the
   actual event times and a ~100 ms look-ahead with a ~25 ms polling grain, driven off a
   Worker so background-tab throttling can't starve it. — Chris Wilson, *A Tale of Two Clocks*
   (https://web.dev/articles/audio-scheduling).

4. **Continuous control belongs on `AudioParam` (sample-accurate, a-rate), not main-thread
   timers.** — web.dev *A Tale of Two Clocks*; W3C Web Audio API AudioParam automation model.

5. **Plugin Delay Compensation (PDC): the host reads each node's reported latency, takes the
   session maximum as the anchor, and nudges every other track by (max − ownLatency).** Every
   latency-bearing node — built-in *and* third-party — must report truthfully, or that path
   drifts. "Not all plugins correctly report latency to the host … the plugin developer has
   to implement this correctly." — puremix / macProVideo, *Understanding Plug-In Delay
   Compensation* (https://www.puremix.net/blog/understanding-plug-in-delay-compensation.html).

6. **Single live `AudioContext`; `OfflineAudioContext` only for deterministic render/decode.**
   Multiple live contexts cannot share a clock and double-allocate hardware buffers.
   — web-audio-engine skill rule #1; W3C Web Audio API.

7. **Underrun observability.** Mature engines surface an xrun/dropout counter so glitches are
   diagnosable rather than silent. — Chrome design pattern; general DAW engineering practice.

---

## Current-State Map

**Graph owner** — `src/modules/AudioEngine/repositories/createWebAudioEngine.ts` (1190 lines).
- Single live context: `new AudioContext({ latencyHint: 'interactive' })` at `:178`; a no-op
  `OfflineAudioContext(2,1,44100)` shim backs fallback mode (`:96`, `createNoopAudioContext`).
- Master chain `masterGain → (metering-processor) → masterAnalyser → destination`; meter
  inserted post-worklet-load in `wireMasterMeter` (`:253-300`), idempotent on re-init.
- Worklet module load: `loadWorklets` (`:238-242`) `addModule`s sidechain / native-plugin-host /
  native-plugin-bridge / recording / metering; per-node WASM worklets registered lazily via
  `ensureWorkletRegistered`. Init promise caches success but not rejection (`:220-233`).
- Transport SAB seqlock writer `setTransportInfo` (`:751-781`) — Atomics odd/even around 7 f64.
- `getMasterPeakLevel` (`:588-593`) plain read-and-reset of a 1-float SAB.
- `stopAllScheduled` / allNotesOff fan-out (`:1049-1094`): one `allNotesOff` message per synth
  device (Fermenter/Toaster worklet port; GrandBoule/Levain via control surfaces) — collapses
  the old 128×/16× note-off structured-clone storm.

**Strip topology** — `engine/TrackNode.ts`: `gainNode → preFaderTap → faderNode → postFaderGain
→ panNode → analyserNode → output` (`:53-108`). Fader/pan/mute via `setTargetAtTime` smoothing
(`:167-180`). SAB meter with AnalyserNode time-domain fallback (`getPeakLevel :183`).

**Worklet processors** — `services/*Processor.ts` (the actual `AudioWorkletProcessor` source,
each ends in `registerProcessor(...)`): fermenter, toaster, grandBoule, gluten, proof,
proofChamber, bacteria, grinder, knead, levain, scoring, metering, recording.

**Shared worklet infra** — `infra/audioWorklet/workletInitShared.ts`: per-(context,url)
`addModule` cache, URL-keyed WASM-binary fetch cache, `createReadyHandshake` (ready/error/10 s
timeout). `engine/telemetryAllocator.ts`: one 64-slot SAB, 32 f32/slot, documents a seqlock at
`TELEMETRY_SEQ_IDX=31` (`:20-31`).

**Scheduling** — `Transport/useCases/playheadScheduler/`: Worker-thread clock, `grainMs`
default 10 ms, `SCHEDULE_AHEAD_SECONDS = 0.1` (`startPlayheadScheduler.ts:37`), async tick with
re-entrancy guard + generation/discontinuity epochs (`schedulerSession.ts:24-72`). Matches the
two-clocks golden pattern.

**Latency compensation** — `AudioEngine/useCases/latencyCompensation/compensation/`:
`getCompensationDelay = (maxTrackLatency − trackLatency)/1000` s; `getTrackLatency` folds device
+ downstream output/send/sidechain latency (recursive, cycle-guarded); `getDeviceLatencyMs`
prefers runtime-reported `externalLatencyRegistry` else static `deviceLatencyMap`. WASM devices
report real latency through `wasmDeviceRegistry.ts` (`reportLatency`, 8 call sites).

**Resume/gesture** — `WorkspaceShell/presentations/hooks/useAppInitialization.ts:67-84`:
one-shot `click`/`keydown` → `resumeEngine()`.

**GrandBoule offload** — `workers/grandBouleEngineWorker.ts` + `engine/GrandBouleNode.ts`: heavy
physical-model DSP runs in a Web Worker feeding the worklet through a lock-free Atomics ring
buffer (`grandBouleProcessor.ts:27-140`), so the render thread never risks the 2.67 ms deadline.

---

## Findings

Severity: **blocker** (silences/corrupts audio for real users) / **major** (audible or
measurable RT risk under realistic load) / **minor** (bounded, cosmetic, or latent) /
**polish**. Effort: **S/M/L**.

### RT-1 — Per-render-quantum heap allocation in 7 of the WASM worklet processors — **major, M**

`process()` builds fresh `new Float32Array(memory, ptr, frames)` views **every block** in:
`proofProcessor.ts:143-155` (×4), `glutenProcessor.ts:153-176` (×4–6 incl. sidechain),
`bacteriaProcessor.ts:139-161` (×4 + `bandView`), `scoringProcessor.ts:111-115` (×2),
`proofChamberProcessor.ts:175-176` (×2), `levainProcessor.ts:280-283` (×2),
`fermenterProcessor.ts:296-305` (×2–3). `kneadProcessor.ts:222-256` allocates on ptr/frame
change but reuses steady-state.

A `Float32Array` view is a heap object even though it copies no bytes; at 128-sample quanta the
render thread mints 2–6 of them ~344×/s per device, feeding periodic GC.

**This exact rule is written into the codebase and then violated:** `kneadProcessor.ts:68-73` —
"A `new Float32Array(memory, ptr, frames)` is a heap allocation even though it copies no bytes,
so we must not build one per render quantum." The RT-correct pattern already exists in three
processors: `grinderProcessor.ts:316-320` (cache at init, reuse at `:372-395`), knead's
ptr-keyed revalidation, `toasterProcessor.ts:195-203`. The other seven never adopted it.

- **Failure mode:** GC pauses on the audio render thread → intermittent dropouts.
- **Firing condition:** continuous playback with any Proof/Gluten/Bacteria/Scoring/ProofChamber/
  Levain/Fermenter instance active; worsens with instance count.
- **Blast radius:** every project using those devices (Proof mastering + Fermenter are core).
- Standard: golden #1.

### RT-2 — Telemetry seqlock implemented for only 1 of 5 SAB telemetry devices — **major, M**

`telemetryAllocator.ts:20-31` documents the seqlock as *the* mechanism preventing torn
multi-field snapshots, and every slot ships a `seqView`. Only **Proof** uses it: writer
`proofProcessor.ts:159-195` (Atomics odd/write/even), reader `ProofNode.ts:64-92` (retry loop).

Gluten (`glutenProcessor.ts:189-196`), Grinder (`:433-443`), Bacteria (`:153-162`), and Scoring
(`:123-134`) write their fields with **plain non-atomic stores and no seqlock**, and their nodes
read `slot.view[idx]` directly with **no retry** (`GlutenNode.ts:67`, `GrinderNode.ts:78`,
`BacteriaNode.ts:67`, `ScoringNode.ts:61`).

- **Failure mode:** a main-thread poll interleaved with a worklet write reads a torn snapshot
  (e.g. Bacteria `bandView` `.set(bandView,3)` at `:162` mixing bands across two blocks; Grinder
  gate-state + latency from different quanta).
- **Firing condition:** any poll overlapping the ~every-8-blocks write window.
- **Blast radius:** meter/telemetry displays only — cosmetic — but the documented safety
  invariant is unmet for 4/5 devices, so the guarantee readers assume does not hold.
- Standard: golden #2.

### RT-3 — `postMessage` (with allocation + transfer) from inside `process()` — **major, S**

`fermenterProcessor.ts:318` posts, from the render thread every ~46 ms, a freshly-allocated
`new Float32Array(128)` scope buffer plus peaks **with a transfer list** —
`this.port.postMessage({...}, [scopeBuffer.buffer])`. This is allocation **and** a MessagePort
send on the audio thread. Fermenter is the only device that ships telemetry over the port at
all; every other device uses the SAB slot. Additional `latency-changed` port sends fire from the
param/telemetry paths at `bacteriaProcessor.ts:82`, `glutenProcessor.ts:93`,
`grinderProcessor.ts:273/281`, `proofProcessor.ts:98` (rare, but on the audio thread).

- **Failure mode:** allocation + structured-clone/transfer enqueue on the render thread → GC and
  message-port work competing with the 2.9 ms budget.
- **Firing condition:** any active Fermenter voice (scope runs whenever the device exists).
- **Blast radius:** Fermenter is a flagship device — commonly instantiated multiple times.
- Standard: golden #1, #2.

### RT-4 — Native / third-party plugin latency is never reported to PDC — **major, M**

`getDeviceLatencyMs.ts` returns `deviceLatencyMap[deviceType] ?? 0`, and `helpers.ts`
`deviceLatencyMap` contains only 6 built-in types (all `0` except `builtin-sidechain-compressor`).
`reportLatency` is called **only** from `engine/wasmDeviceRegistry.ts` (WASM devices). Grep of
`engine/NativePluginBridgeNode.ts` and `deviceStrategy/NativeDspDeviceStrategy.ts` for
`reportLatency`/`get_latency`/`latency` returns **nothing** — native (VST/AU/CLAP) plugins report
zero latency, so PDC treats them as instantaneous.

- **Failure mode:** a hosted native plugin with lookahead (linear-phase EQ, lookahead limiter)
  runs uncompensated; its track drifts late against the rest of the mix.
- **Firing condition:** any latency-bearing native plugin in a multi-track project.
- **Blast radius:** every session mixing native plugins with other tracks; grows with plugin
  latency (golden-standard example: 1500-sample linear-phase EQ).
- Standard: golden #5. Corroborated: "Not all plugins correctly report latency to the host."

### RT-5 — Live automation playback is neither PDC-compensated nor sample-accurate — **major, M**

`scheduleAudioClips.ts:90/142` and `scheduleMidiNotes.ts:264/431` schedule sources at
`getCurrentTime() + offset + compensation` (sample-accurate, look-ahead, PDC-delayed). But
**live automation** — `Transport/.../applyAutomation/applyAutomation.ts` — is applied
**imperatively at the scheduler grain** (~10 ms) at `currentBeat`/`context.currentTime`, with an
exponential slew (`SLEW_ALPHA=0.4`), and **contains no `getCompensationDelay` term**
(grep clean). Gain/pan land via `engineSetTrackGain`/`engineSetTrackPan` →
`TrackNode.setTargetAtTime(..., currentTime, 0.01)` (`TrackNode.ts:167-180`).

Two gaps against the golden standard:
- **PDC mismatch:** on a track whose clips/MIDI are delayed by `compensation`, the automation
  is not, so automation leads the audio it modulates by up to the session max latency.
- **Not sample-accurate:** automation resolution is tick-bound (~10 ms) and main-thread-driven,
  not scheduled a-rate on `AudioParam`. Grinder proves the right pattern exists — it consumes
  real a-rate `parameters[...]` arrays (`grinderProcessor.ts:396-420`) — but the generic
  automation lane bypasses it.

- **Failure mode:** rhythmic filter/volume/pan automation audibly early relative to compensated
  audio, and stair-stepped at the tick rate under fast moves.
- **Firing condition:** automation lanes on a project with any non-zero PDC or fast automation.
- **Blast radius:** all automated playback in latency-bearing sessions.
- Standard: golden #4, #5.

### RT-6 — Built-in Web Audio device latency reported as zero — **minor, M (Web-Audio-limited)**

`createLimiter.ts` (Crust) is a `DynamicsCompressorNode` + makeup gain; `deviceLatencyMap` maps
`builtin-compressor`/limiter to `0`. Chrome's `DynamicsCompressorNode` carries an inherent
lookahead latency (~6 ms) that no Web Audio API exposes, so PDC cannot see it and treats these
nodes as zero-latency.

- **Failure mode:** tracks using the built-in compressor/limiter drift ~6 ms uncompensated.
- **Firing condition:** built-in compressor/limiter on one track among others.
- **Blast radius:** modest fixed offset; bounded. Partly a platform limitation (no queryable
  latency), so listed minor / open question.
- Standard: golden #5.

### RT-7 — Cache-at-init processors don't revalidate views on WASM `memory.grow()` — **minor, S**

`grinderProcessor.ts:316-320`, `toasterProcessor.ts:195-203`, and GrandBoule cache WASM-memory
views **once at init** and never check buffer identity again. If the WASM linear memory grows at
runtime, `memory.grow()` **detaches** the old `ArrayBuffer`, leaving the cached views
zero-length/detached. `kneadProcessor.ts:222-231` is the only processor that revalidates on
`mem !== this._viewBuffer`.

- **Failure mode:** silent output or a fault after a growth event; the RT-1 remediation (adopt
  caching everywhere) must not reintroduce this by caching without revalidation.
- **Firing condition:** any daw-dsp instance whose WASM heap grows during playback.
- **Blast radius:** latent — depends on whether daw-dsp ever grows memory post-init (see Open
  Questions). If it pre-allocates fixed buffers and never grows, this never fires.
- Standard: correctness precondition for golden #1.

### RT-8 — Resume-on-gesture listeners are one-shot and not re-armed on failure — **minor, S**

`useAppInitialization.ts:67-84` registers `click` and `keydown` with `{ once: true }`. On
`resumeEngine()` rejection it notifies "Audio could not start — click anywhere to try again,"
but the `once` listeners have already auto-removed, so the surviving modality is single-use and
the re-arm prompt has no backing listener after both fire. Separately, `requestMicPermission()`
fires unconditionally on the first gesture (mic prompt even for users who never record).

- **Failure mode:** first-gesture resume failure (transient suspended state) leaves the app
  silent with a prompt that does nothing.
- **Firing condition:** resume rejects on the first trusted gesture.
- **Blast radius:** startup UX; recoverable only by reload.
- Standard: golden #6 (resume/gesture discipline).

### RT-9 — Non-atomic scalar meter SAB — **polish, S**

`meteringProcessor.ts` and the master meter (`createWebAudioEngine.ts:588-593`) write/read a
single f32 peak with plain (non-Atomic) access and read-and-reset. For a single 4-byte aligned
scalar with one writer / one reader this cannot tear on real hardware; the worst case is a lost
peak update between polls. Acceptable, but it is an undocumented deliberate divergence from the
Atomics discipline the multi-field slots use — worth an inline note so it isn't "fixed" into a
seqlock or mistaken for an oversight.

### RT-10 — No underrun / xrun observability — **minor, M**

Grep of `src/modules/AudioEngine` for `underrun|xrun|dropout|overrun|glitch|deadline` finds only
the GrandBoule ring buffer, which **detects** starvation (`grandBouleProcessor.ts:52,135`) and
**silently outputs silence with no counter**. There is no engine-wide dropout/xrun metric.
`getHealth()` (`createWebAudioEngine.ts`) surfaces init/resume errors only — nothing runtime.

- **Failure mode:** glitches are undiagnosable; RT-1/RT-3 GC dropouts leave no trace.
- **Blast radius:** diagnosability across the whole engine.
- Standard: golden #7.

---

## Strengths (observed, for balance)

- **Single-context discipline holds.** One live engine `AudioContext`; the only other live
  `new AudioContext()` sites (`AudioAnalysis/repositories/{browserStemSeparation,generateAudio,
  separateStems}.ts`) are transient decode contexts that `close()` immediately. All render/export
  paths use `OfflineAudioContext`. (Minor note: those three could share one decode context rather
  than spinning transient hardware contexts.)
- **Transport SAB seqlock is correct** (`setTransportInfo :751-781`, reader `kneadProcessor.ts:
  152-156`) — Atomics odd/even, single writer, retry reader.
- **Scheduler** matches golden #3: Worker clock, 100 ms look-ahead / 10 ms grain, async
  re-entrancy guard, generation + discontinuity epochs.
- **GrandBoule Worker offload** with a lock-free Atomics ring buffer is an advanced, standard-
  aligned answer to heavy-DSP deadline risk.
- **allNotesOff** collapses a 128×/16×-per-device structured-clone storm into one message.
- **Grinder** is the reference RT-clean processor: cached views + real a-rate `AudioParam`
  automation.

---

## Remediation Roadmap

First-class fixes only; ordered by RT impact. (Prescriptive detail intentionally minimal per
audit contract — these are directions, not designs.)

1. **RT-1 / RT-7 (major):** adopt the knead/grinder cached-view pattern **with buffer-identity
   revalidation** across the seven allocating processors; make "no view allocation in
   steady-state `process()`" a reviewable RT invariant. (M)
2. **RT-3 (major):** move Fermenter telemetry to a SAB slot (matching the other devices) so no
   allocation or port send happens on the render thread. (S)
3. **RT-4 (major):** thread native-plugin reported latency into `externalLatencyRegistry` via
   `reportLatency`, same as WASM devices. (M)
4. **RT-5 (major):** apply `getCompensationDelay` to automation and move continuous automation
   onto sample-accurate `AudioParam` scheduling (Grinder's a-rate path is the template). (M–L)
5. **RT-2 (major):** apply the Proof seqlock (writer + retry reader) to Gluten/Grinder/Bacteria/
   Scoring, or explicitly downgrade the telemetryAllocator's documented guarantee. (M)
6. **RT-10 (minor):** add a dropout/xrun counter (start with GrandBoule's already-detected
   underruns) surfaced through `getHealth()`. (M)
7. **RT-6 / RT-8 / RT-9 (minor/polish):** document the DynamicsCompressor latency gap; re-arm
   the resume listeners on failure and gate the mic prompt; annotate the scalar-meter non-atomic
   choice. (S each)

---

## Open Questions

1. **Seqlock payload race (design policy).** Even in Proof, the seqlock guards *snapshot*
   integrity while the payload floats are non-atomic stores racing non-atomic reads — a data
   race under the JS memory model, relying on aligned-4-byte hardware atomicity. Is this an
   accepted, documented team policy, or should payloads be Atomics too?
2. **Does daw-dsp `memory.grow()` at runtime?** Determines whether RT-7 is latent or live and
   whether the RT-1 caching fix must revalidate. Needs a Rust-side answer (crate memory model).
3. **Main-thread poll GC.** Each SAB-metered node runs its own `setInterval(16)` allocating a
   nested snapshot object per poll (e.g. `ProofNode.ts:159-163`). Is aggregate main-thread poll
   allocation a measured concern at high device counts?
4. **`DynamicsCompressorNode` latency.** Is a fixed empirical constant (per sample rate)
   acceptable for PDC, given the API exposes none?

---

## Unverified / Not Run

- No live browser profiling was performed; RT-1/RT-3 GC impact is argued from allocation counts
  and the cited standard, not from a captured dropout trace. A DevTools performance capture under
  multi-Proof/Fermenter playback would quantify it.
- Rust-side latency truthfulness (whether `get_latency_samples()` matches actual DSP delay per
  device) was inspected only at the TS boundary.
- `ControlSurface/workers/controllerScriptingWorker.ts` (the "known deps warn") uses
  `new Function(...)` to run user controller scripts; it runs in a Worker off the audio thread,
  so it is out of RT-core scope and only noted here as an anomaly.
