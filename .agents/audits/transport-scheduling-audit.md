# Transport & Playhead Scheduling Audit Report

Based on a code-level audit of the transport scheduler (`src/modules/Transport/useCases/playheadScheduler.ts`) and audio/MIDI scheduling logic (`scheduleAudioClips.ts`, `scheduleMidiNotes.ts`, `applyAutomation.ts`), here is the comprehensive audit report:

### 🌟 Architectural Positives
1. **State-Free Playhead Ref (`playheadPositionRef.ts`)**:
   *   **Implementation:** The continuous playhead position is updated via a mutable ref (`playheadPositionRef.current = newPosition`) rather than a reactive state store (like Zustand or React Context). 
   *   **Impact:** This completely avoids the "100Hz Problem." The main React tree is not forced to re-render 100 times per second during playback, keeping the UI responsive and preventing main-thread starvation.
2. **Audio Clip Scheduling (`scheduleAudioClips.ts`)**:
   *   **Implementation:** Audio clips correctly utilize the "Tale of Two Clocks" pattern, calculating exact future timestamps (`getCurrentTime() + beatOffset / ...`) and scheduling native Web Audio playback via `source.start(iterStartTime, ...)`. This ensures sample-accurate audio playback regardless of main-thread load.

### 🚨 Critical Performance & Accuracy Bugs

1. **Jittery MIDI Event Scheduling via `setTimeout` (`scheduleMidiNotes.ts`)**:
   *   **Issue:** While `scheduleAudioClips` correctly schedules audio natively, `scheduleMidiNotes.ts` relies on JavaScript's `setTimeout` to trigger notes for the native Rust/WASM plugins (Toaster, Fermenter, Levain).
       ```typescript
       setTimeout(() => {
           dn.fermenterControls?.noteOn(pitch, note.velocity);
       }, scheduleDelay * 1000);
       ```
   *   **Impact:** `setTimeout` is notoriously imprecise and is blocked by main-thread activity (UI renders, GC pauses). Notes will trigger with severe jitter, completely destroying the timing and groove of MIDI sequences. A DAW cannot rely on `setTimeout` for musical timing.
   *   **Fix:** The Rust AudioWorklet processors must implement a lock-free event queue (via `SharedArrayBuffer` or a WASM-side queue). The main thread should push timestamped MIDI events into this queue in advance, and the `process` loop in the AudioWorklet should pull and trigger them at the exact sample frame.

2. **Zipper Noise & Message Flooding in Automation (`applyAutomation.ts`)**:
   *   **Issue:** The `applyAutomation` function runs on every scheduler tick (~100Hz). It calculates a single instantaneous automation value at the current beat and immediately sets it via `engineSetTrackGain(lane.trackId, value)` or `updateDeviceParam(...)`.
   *   **Impact:** 
       1. **Audio Artifacts:** Instantly jumping a parameter value every 10ms causes "zipper noise" (audible stepping/clicking) instead of a smooth sweep.
       2. **Message Flooding:** Sending hundreds of `postMessage` updates to the AudioWorklet per second for every automated parameter will choke the IPC bridge and starve the audio thread.
   *   **Fix:** Automation should utilize the Web Audio API's native scheduling curves (`AudioParam.setValueCurveAtTime` or `linearRampToValueAtTime`) passing an array of future points, or the worklet should implement parameter smoothing (which some Rust plugins do, but native GainNodes need Web Audio ramps).

3. **Missing Loop Wrap Fade-Outs (`playheadScheduler.ts`)**:
   *   **Issue:** When the transport loops (`newPosition >= current.loopEnd`), the scheduler instantly stops all active audio sources:
       ```typescript
       stopAllScheduled();
       for (const src of activeAudioSources) { src.stop(); }
       ```
   *   **Impact:** Hard-stopping audio sources without a 3-5ms micro-fade out guarantees a loud digital pop/click every time the loop boundary wraps around.
   *   **Fix:** Schedule a very fast `linearRampToValueAtTime(0, now + 0.005)` on the gain nodes of all active sources before calling `stop()`.

**Summary:** The transport module has the right high-level architecture (avoiding React state for the playhead and using a lookahead tick loop), but it severely compromises MIDI timing by relying on `setTimeout` for plugin note events. Furthermore, automation is resolved instantaneously without smoothing curves, causing zipper noise and message flooding.
