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
- **Offline Rendering:** Recreates the audio graph and schedules clips, but entirely ignores PDC offsets. Suspends the context to post MIDI messages to Worklets.
- **Routing:** `TrackNode` rebuilds its entire internal AudioNode graph whenever a device is added, removed, or bypassed.

## Findings
- **PDC Computation ignores Bus Routing:** `getTrackLatency(trackId)` only sums the latency of devices placed directly on the track. It does not traverse the graph to account for latency introduced by devices on Buses that the track routes to.
- **Offline Rendering ignores PDC:** `scheduleTrackClips.ts` schedules clips using raw `beatToSeconds(startBeat)` without applying `getCompensationDelay(trackId)`. Tracks with WASM/Faust plugins will be misaligned in exported stems and mixdowns.
- **Race Condition in Offline Render Worklet Scheduling:** `schedulePendingSuspends.ts` suspends the `OfflineAudioContext`, sends a `postMessage` to trigger a note, and immediately calls `resume()`. Because `postMessage` is asynchronous across thread boundaries, the `OfflineAudioContext` will likely render past the event's `sampleFrame` before the worklet receives the message, resulting in dropped or late notes in exports.
- **Recording alignment is broken:** Captured audio, MIDI, and automation data do not account for round-trip latency, resulting in out-of-sync recorded clips and late automation points.
- The engine's core routing (`TrackNode`) is heavily coupled to specific product features (`Fermenter`, `Toaster`, `Levain`), rather than treating all devices as polymorphic plugins.
- Metering currently happens on the main thread via `AnalyserNode`.
- Automation for WASM plugins applies a main-thread single-pole IIR slew (`SLEW_ALPHA`) which avoids zipper noise but binds automation resolution to the UI/scheduler tick rate rather than sample rate.

## Priorities
1. Fix Offline Rendering Race Condition for Worklet Instruments.
2. Implement Recording Latency Compensation (Audio, MIDI, and Automation).
3. Apply PDC scheduling offsets to Offline Rendering (`scheduleTrackClips.ts`).
4. Traverse graph routing in `getTrackLatency()` so Bus latency is accounted for.
5. Refactor `TrackNode` to stop tearing down the graph on parameter/bypass updates.
6. Move metering from `AnalyserNode` polling to `AudioWorklet` + SAB taps.
7. Prevent main-thread allocation spikes during audio recording stop.

## Open issues

**1. Offline Rendering Race Condition drops Worklet Notes**
- **Problem:** `schedulePendingSuspends.ts` triggers notes during offline rendering by suspending the context, posting a message, and resuming. `postMessage` takes ~1-3ms to reach the audio thread, but `resume()` allows the offline render to process thousands of frames instantly. The worklet receives the message *after* the `sampleFrame` has passed, dropping the note.
- **Files:** `src/modules/AudioEngine/useCases/offlineRender/schedulePendingSuspends.ts`, `FermenterNode.ts`.
- **Needed:** Avoid `suspend()` for note scheduling. Instead, pre-calculate the array of all `{ type: 'noteOn', sampleFrame, ... }` events for the track and send them to the worklet in a single `postMessage` *before* calling `offlineCtx.startRendering()`. The worklet must queue these and process them accurately when `currentFrame >= sampleFrame`.

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

**5. Graph Teardown Anti-Pattern in TrackNode**
- **Problem:** `TrackNode.rebuildChain()` drops and reconnects the entire audio graph (`preFaderTap`, `faderNode`, `panNode`, all devices) whenever a plugin is added or removed. This violates the `web-audio-engine` skill ("reconcile rather than recreate") and risks audio dropouts/clicks.
- **Files:** `src/modules/AudioEngine/engine/TrackNode.ts`.
- **Needed:** Implement targeted reconciliation. When adding a device, disconnect only the previous node's output and wire the new device inline.

**6. Main-Thread DSP (Metering)**
- **Problem:** `TrackNode.getPeakLevel()` reads 256 samples on the main thread via `analyserNode.getFloatTimeDomainData()`. This couples metering to UI render frames and violates real-time isolation rules.
- **Files:** `src/modules/AudioEngine/engine/TrackNode.ts`.
- **Needed:** Replace `AnalyserNode` with an `AudioWorklet` metering tap that writes peak/RMS values into a `SharedArrayBuffer` (similar to the telemetry allocator).

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
Address **Issue #1 (Offline Rendering Race Condition)**, **Issue #2 (Recorded Latency)**, and **Issue #3 (Offline Rendering PDC)** as the immediate first steps. These all result in corrupted exports or un-usable recorded data, representing the most critical functionality of a DAW.

## Resolved
*(None yet)*