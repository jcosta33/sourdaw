# Recording, Engine, and Latency Audit

## Scope
This audit covers the end-to-end implementation of audio/MIDI recording, Web Audio engine performance, latency compensation (PDC), routing, and scheduling. It specifically focuses on `TrackNode.ts`, `recording.ts`, the latency compensation module, and the MIDI/Arrangement recording ingest paths.

## Goal
The audio engine must be real-time safe, sample-accurate, and fully decouple parameter changes from topology changes (as per `web-audio-engine` skill). Recording (both Audio and MIDI) must be robust, artifact-free, and correctly synchronized. Latency from heavy DSP (WASM/Worklets) must be compensated so all tracks align perfectly on playback.

## Relevant code paths
- `src/modules/AudioEngine/engine/TrackNode.ts` (Core routing, graph rebuilds, metering)
- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts` (Audio Worklet SAB recording)
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts` (Recording trigger)
- `src/modules/Arrangement/useCases/recording/startRecording.ts` (Clip creation)
- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/getCompensationDelay.ts` (PDC computation)
- `src/modules/MIDI/useCases/midiLearn/handleMidiMessage.ts` (MIDI ingest)

## Current behavior
- **Audio Recording:** Uses an `AudioWorklet` (`recording-processor`) to write 128-sample blocks into a `SharedArrayBuffer` (SAB). A background Worker drains the SAB to OPFS every 50ms.
- **MIDI Recording:** Clicking "Record" creates empty MIDI clips on armed tracks in the Arrangement module.
- **Latency:** Device latency is queried from WASM instances and aggregated per track.
- **Routing:** `TrackNode` rebuilds its entire internal AudioNode graph whenever a device is added, removed, or bypassed.

## Findings
- The `AudioWorklet` to SAB pipeline for audio recording is an excellent, zero-allocation architectural choice for real-time safety.
- The engine's core routing (`TrackNode`) is heavily coupled to specific product features (`Fermenter`, `Toaster`, `Levain`), rather than treating all devices as polymorphic plugins.
- There are significant gaps between state computation and engine application (e.g., Latency, MIDI notes).

## Priorities
1. Fix missing Latency Compensation application (Critical functional failure).
2. Implement actual MIDI note ingest during recording (Missing feature).
3. Refactor `TrackNode` to stop tearing down the graph on parameter/bypass updates.
4. Move metering from `AnalyserNode` polling to `AudioWorklet` + SAB taps.
5. Prevent main-thread allocation spikes during audio recording stop.

## Open issues

**1. Latency Compensation computed but never applied**
- **Problem:** `getCompensationDelay(trackId)` accurately calculates the required PDC based on device chain latencies, but this delay is never applied to the audio signal. Playback of tracks with different DSP chains will be visibly and audibly out of sync.
- **Files:** `src/modules/AudioEngine/useCases/latencyCompensation/compensation/getCompensationDelay.ts`, `TrackNode.ts`.
- **Needed:** Insert a `DelayNode` at the end of each `TrackNode` strip (or pre-fader) and set its `delayTime.value` to the result of `getCompensationDelay(trackId)`. Update this delay when the device chain changes.

**2. MIDI Recording is a stub (No incoming notes captured)**
- **Problem:** The transport creates empty MIDI clips when recording starts (`startRecording.ts`), but incoming WebMidi events (`onmidimessage`) are only routed to MIDI Learn and live playback. The notes are never appended to the active clip in the `midiStore`.
- **Files:** `startRecording.ts`, `src/modules/MIDI/useCases/midiLearn/handleMidiMessage.ts`.
- **Needed:** Wire the WebMidi input event listener to check `activeRecordingRef` or `getTransportState().isRecording` and append incoming note-on/note-off pairs to the active clip's data in the store.

**3. Graph Teardown Anti-Pattern in TrackNode**
- **Problem:** `TrackNode.rebuildChain()` drops and reconnects the entire audio graph (`preFaderTap`, `faderNode`, `panNode`, all devices) whenever a plugin is added or removed. This violates the `web-audio-engine` skill ("reconcile rather than recreate") and risks audio dropouts/clicks.
- **Files:** `src/modules/AudioEngine/engine/TrackNode.ts`.
- **Needed:** Implement targeted reconciliation. When adding a device, disconnect only the previous node's output and wire the new device inline.

**4. Main-Thread DSP (Metering)**
- **Problem:** `TrackNode.getPeakLevel()` reads 256 samples on the main thread via `analyserNode.getFloatTimeDomainData()`. This couples metering to UI render frames and violates real-time isolation rules.
- **Files:** `src/modules/AudioEngine/engine/TrackNode.ts`.
- **Needed:** Replace `AnalyserNode` with an `AudioWorklet` metering tap that writes peak/RMS values into a `SharedArrayBuffer` (similar to the telemetry allocator).

**5. Main-Thread Allocation Spike on Audio Record Stop**
- **Problem:** `stopAudioRecording` receives a single, massive `Float32Array` from the OPFS worker and synchronously creates an `AudioBuffer` for the entire take. For a 10-minute take, this allocates ~115MB on the main thread in one block, causing jank.
- **Files:** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts` (`buildAndDeliver`).
- **Needed:** Stream the OPFS file directly into the project's audio clip storage (or stream to an offline context buffer) rather than transferring the raw PCM to the main thread all at once.

**6. Hardcoded Device Types in TrackNode**
- **Problem:** `TrackNode.addDevice` contains hardcoded `if`/`else` branches for `fermenter`, `toaster`, `levain`, etc. This violates the Open-Closed Principle.
- **Files:** `src/modules/AudioEngine/engine/TrackNode.ts`.
- **Needed:** Create a unified `DeviceController` interface that all plugins (builtin, WASM, Faust) implement, and map them polymorphically.

## Open questions
- Are we supporting PDC for live input monitoring, or only for playback? Applying `DelayNode` to live microphone input will make monitoring impossible due to echo. PDC must be bypassed for tracks that are armed/monitoring.
- Does the OPFS background worker have a fallback if `SharedArrayBuffer` drops frames due to thread starvation?

## Risks
- **Desync:** Without applying latency compensation, users tracking to a heavy project will inherently play out of time.
- **Lost Takes:** The `recordingSession` HMR persistence is clever, but relying on a Worker `postMessage` of a massive Float32Array on stop is a high risk for OOM crashes on lower-end devices.

## Suggested approaches
- **PDC Application:** Add a `DelayNode` to `TrackNode.strip`. On playback, set it to `compensationDelay`. If the track is armed for recording, bypass the delay to preserve live monitoring feel, but shift the resulting recorded clip *backward* by the sum of `contextBaseLatency` + `deviceLatency`.
- **MIDI Recording:** Create a new `recordMidiEvent.ts` useCase that is called directly from the WebMidi hardware listener, ensuring it uses performance.now() or `event.timeStamp` for sample-accurate scheduling.

## Recommendation
Address **Issue #1 (Latency Compensation application)** first, as it is a fundamental correctness requirement for the DAW engine. Then address **Issue #2 (MIDI Recording)** to complete the basic user loop.

## Resolved
*(None yet)*
