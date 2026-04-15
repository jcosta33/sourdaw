# Recording, Engine, and Latency Audit

## Scope
This audit covers the end-to-end implementation of audio/MIDI recording, Web Audio engine performance, latency compensation (PDC), routing, and scheduling. It specifically focuses on `TrackNode.ts`, `recording.ts`, the latency compensation module, offline rendering, and the MIDI/Arrangement recording ingest paths.

## Goal
The audio engine must be real-time safe, sample-accurate, and fully decouple parameter changes from topology changes (as per `web-audio-engine` skill). Recording (both Audio and MIDI) must be robust, artifact-free, and correctly synchronized. Latency from heavy DSP (WASM/Worklets) must be compensated so all tracks align perfectly on playback, and recorded material must be shifted backwards to compensate for hardware and DSP round-trip latency.

## Relevant code paths
- `src/modules/AudioEngine/engine/TrackNode.ts` (Core routing, graph rebuilds, metering)
- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts` (Audio Worklet SAB recording)
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts` (Audio recording ingest)
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts` (MIDI recording ingest)
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts` (Live Playback PDC)
- `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts` (Offline Rendering)
- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/helpers.ts` (PDC computation)

## Current behavior
- **Audio Recording:** Uses an `AudioWorklet` (`recording-processor`) to write 128-sample blocks into a `SharedArrayBuffer` (SAB). A background Worker drains the SAB to OPFS every 50ms. When recording stops, the full buffer is transferred to the main thread.
- **MIDI Recording:** Incoming WebMidi events (`onmidimessage`) are captured by `messageHandlers.ts` and appended to the active MIDI clip via `handleNoteOff`.
- **Live Playback Latency (PDC):** Correctly implemented for track-level plugins! `getCompensationDelay(trackId)` shifts the scheduling of clips forward to align tracks.
- **Recording Latency:** Neither Audio nor MIDI recording applies latency compensation offsets to the captured data.
- **Offline Rendering:** Recreates the audio graph and schedules clips, but entirely ignores PDC offsets. Worklet instrument notes are triggered via batched `OfflineAudioContext.suspend(time)` callbacks that call `instrumentControls.noteOn/noteOff`, then `resume()` — not raw `postMessage` to the worklet in this module.
- **Routing:** `TrackNode.rebuildChain()` runs when devices are **added** or **removed**, and when **bypass** changes for devices that use the generic bypass path (`dn.bypassed` + reconnect). **Per-parameter updates** (`updateParam`) do **not** rebuild the chain; they forward to device controls / `AudioParam`. **Fermenter / Toaster / Levain** bypass uses `setBypass` on controls without a full reconnect when applicable.

## Findings
- **PDC Computation ignores Bus Routing:** `getTrackLatency(trackId)` only sums the latency of devices placed directly on the track. It does not traverse the graph to account for latency introduced by devices on Buses that the track routes to.
- **Offline Rendering ignores PDC:** `scheduleTrackClips.ts` schedules clips using raw `beatToSeconds(startBeat)` without applying `getCompensationDelay(trackId)`. Tracks with WASM/Faust plugins will be misaligned in exported stems and mixdowns.
- **Offline render instrument scheduling:** `schedulePendingSuspends.ts` batches events, suspends at quantized times, invokes **main-thread** `instrumentControls` (not worklet `postMessage` for note on/off in this file), then resumes. Timing risk is different from the old “async postMessage vs offline clock” story but **suspend/resume vs sample-accurate scheduling** can still miss or misplace notes relative to the offline timeline; pre-queuing sample-frame events in the worklet before `startRendering()` remains safer.
- **Recording alignment is broken:** Captured audio, MIDI, and automation data do not account for round-trip latency, resulting in out-of-sync recorded clips and late automation points.
- The engine's core routing (`TrackNode`) is heavily coupled to specific product features (`Fermenter`, `Toaster`, `Levain`), rather than treating all devices as polymorphic plugins.
- Metering currently happens on the main thread via `AnalyserNode`.
- **Automation slew** uses a single-pole smooth (`SLEW_ALPHA` in `applyAutomation.ts`), not inside `TrackNode` — it affects how values reach scheduled automation, not WASM-specifically.

## Priorities
1. Fix Offline Rendering Race Condition for Worklet Instruments.
2. Implement Recording Latency Compensation (Audio, MIDI, and Automation).
3. Apply PDC scheduling offsets to Offline Rendering (`scheduleTrackClips.ts`).
4. Traverse graph routing in `getTrackLatency()` so Bus latency is accounted for.
5. Refactor `TrackNode` to avoid unnecessary full reconnects where bypass/topology still forces `rebuildChain()` (verify per device type).
6. Move metering from `AnalyserNode` polling to `AudioWorklet` + SAB taps.
7. Prevent main-thread allocation spikes during audio recording stop.

## Open issues

**1. Offline rendering instrument timing**
- **Problem:** Notes for WASM/worklet instruments are not scheduled with per-event `sampleFrame` on the worklet side during offline render. Current path uses `schedulePendingSuspends` + main-thread `instrumentControls` at quantized suspend times — can drift or miss relative to sample-accurate MIDI.
- **Files:** `src/modules/AudioEngine/useCases/offlineRender/schedulePendingSuspends.ts`, device control surfaces used as `instrumentControls`.
- **Needed:** Prefer pre-queuing `{ type: 'noteOn', sampleFrame, ... }` (or equivalent) on the worklet **before** `startRendering()`, or another sample-accurate offline contract; validate exports with multi-note dense MIDI.

**2. Recorded Audio, MIDI, and Automation are not latency-compensated**
- **Problem:** When recording data, it is placed at the raw playhead position without offsetting for input/output hardware latency (`AudioContext.baseLatency` / `outputLatency`) or the track's DSP latency. Recorded clips will always land late.
- **Files:** `toggleRecording.ts`, `messageHandlers.ts`, `recordAutomationValue.ts`.
- **Needed:** When finalizing a recorded audio clip, shift `clip.startBeat` backward by `(baseLatency + inputLatency + compensationDelay) * (tempo / 60)`. Apply a similar offset to MIDI notes and automation points based on `performance.now()`.

**3. Offline Rendering lacks Latency Compensation**
- **Problem:** Exported stems and mixdowns will have misaligned audio. `scheduleTrackClips.ts` does not offset clip start times by `getCompensationDelay(track.id)`. Since the physical WASM/Faust nodes still introduce their processing delay into the `OfflineAudioContext`, the resulting audio will be out of sync.
- **Files:** `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts`.
- **Needed:** Import and apply `getCompensationDelay(track.id)` to all `startTime` scheduling calculations within the offline renderer, identical to the logic in `scheduleAudioClips.ts`.

**4. PDC Calculation ignores Bus Routing**
- **Problem:** `getTrackLatency` only looks at `track.devices`. If Track A routes to Bus 1, and Bus 1 has a heavy linear-phase EQ plugin, Track A will not be delayed to compensate, causing phasing issues with other tracks routing to the master.
- **Files:** `src/modules/AudioEngine/useCases/latencyCompensation/compensation/helpers.ts`.
- **Needed:** Recursively trace `track.outputId` and `track.sends` to accumulate downstream bus latency into the track's total latency.

**5. Graph reconnect cost in TrackNode**
- **Problem:** `rebuildChain()` disconnects strip nodes and all device outputs, then rewires the full chain. This runs on **add/remove device** and on **bypass** for the generic `dn.bypassed` path — **not** on ordinary `updateParam`.
- **Files:** `src/modules/AudioEngine/engine/TrackNode.ts` (`rebuildChain`, `updateBypass`, `addDevice`, `removeDevice`).
- **Needed:** Targeted reconciliation where safe; keep full rebuild when topology requires it.

**6. Main-Thread DSP (Metering)**
- **Problem:** `TrackNode.getPeakLevel()` uses `analyserNode.getFloatTimeDomainData` into `meterBuffer` (`fftSize` / buffer length **256** in `TrackNode` constructor). Peaks are computed on the main thread when callers poll.
- **Files:** `src/modules/AudioEngine/engine/TrackNode.ts` (~93–103, strip setup ~50–70).
- **Needed:** Replace `AnalyserNode` polling with worklet + SAB (or equivalent) if metering must be decoupled from UI cadence.

**7. Main-Thread Allocation Spike on Audio Record Stop**
- **Problem:** `stopAudioRecording` receives a single, massive `Float32Array` from the OPFS worker and synchronously creates an `AudioBuffer` for the entire take. For a 10-minute take, this allocates ~115MB on the main thread in one block, causing jank.
- **Files:** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts` (`buildAndDeliver`).
- **Needed:** Stream the OPFS file directly into the project's audio clip storage (or stream to an offline context buffer) rather than transferring the raw PCM to the main thread all at once.

## Open questions
- Are we tracking `AudioContext.outputLatency` or only `baseLatency` across different browsers for precise recording alignment?
- Does the OPFS background worker have a fallback if `SharedArrayBuffer` drops frames due to thread starvation?

## Risks
- **Dropped Notes in Export:** Due to the offline render race condition, exported songs will randomly miss WASM instrument notes, destroying trust in the bounce engine.
- **Desync:** Without applying latency compensation to recorded material and offline renders, users tracking to a heavy project will inherently play out of time, and their exported masters will be misaligned.
- **Lost Takes:** The `recordingSession` HMR persistence is clever, but relying on a Worker `postMessage` of a massive Float32Array on stop is a high risk for OOM crashes on lower-end devices.

## Suggested approaches
- **Offline Race Condition:** Create an `offlineSchedule(events: NoteEvent[])` method on the `DeviceController` interface that sends the entire array of notes over `postMessage` before rendering begins.
- **Recording Alignment:** In `beginActualRecording()`, calculate `totalLatencyOffsetSeconds = (audioContext.baseLatency || 0) + (audioContext.outputLatency || 0)`. When the buffer is delivered, update the clip's `audioOffsetSeconds` or shift `startBeat` backwards. For MIDI, use `performance.now()` diffs against `event.timeStamp` to place notes accurately.
- **PDC Fixes:** Update `scheduleTrackClips.ts` to add the compensation delay immediately. Update `getTrackLatency()` to traverse the graph to the master out.

## Recommendation
Address **Issue #1 (offline instrument timing)**, **Issue #2 (Recorded Latency)**, and **Issue #3 (Offline Rendering PDC)** as the immediate first steps. Validate exports with real projects after any change.

## Resolved
*(None yet)*

## Verification notes (2026-04-14)

### Pass 2 (full structural read)

| Claim | Result |
|--------|--------|
| `getTrackLatency` / bus graph | **Confirmed** — `helpers.ts`: only `track.devices`, no sends/buses. |
| Offline `scheduleTrackClips` / PDC | **Confirmed** — no `getCompensationDelay`; live `scheduleAudioClips.ts` uses `getCompensationDelay(track.id)`. |
| `schedulePendingSuspends` | **Confirmed** — `suspend().then` → `instrumentControls` note on/off → `resume()`; sorted/batched by quantized time. |
| `TrackNode.rebuildChain` vs params | **Confirmed** — `updateParam` does **not** call `rebuildChain`; rebuild on add/remove device; `updateBypass` rebuilds only in generic branch after `dn.bypassed = bypassed`. |
| `getPeakLevel` / 256 samples | **Confirmed** — `analyserNode.fftSize = 256`, `meterBuffer` length from `frequencyBinCount`, loop over `data.length`. |
| `buildAndDeliver` allocation | **Confirmed** — `recording.ts` ~200–201 `ctx.createBuffer(1, samples.length, sampleRate)` + full `set` on main thread. |
| Automation slew `SLEW_ALPHA` | **Confirmed** — `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts` ~25, ~100. |
| MIDI / audio recording latency offset | **Not implemented in grep pass** — `toggleRecording.ts` had no `baseLatency`/`outputLatency`; treat issue #2 as **still open** until code adds offsets. |

### Pass 3 (2026-04-14) — recording path + OPFS worker

| Claim | Result |
|--------|--------|
| **OPFS drain interval 50 ms** | **Confirmed** — `recordingWorker.ts` `POLL_MS = 50`; `recording.ts` header comments match (~2.4k samples at 48 kHz). |
| **No I/O latency in transport toggle** | **Confirmed** — `toggleRecording.ts` contains no `latency` / `baseLatency` / `outputLatency` symbols (grep); Issue #2 remains **open** at the transport layer. |