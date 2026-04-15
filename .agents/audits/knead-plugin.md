# Knead Plugin End-to-End Audit

## Goal
The Knead plugin aims to provide a professional-grade, real-time pitch correction and editing experience (similar to Melodyne or Auto-Tune). The system must allow the user to view analyzed pitch contours ("blobs") in the UI, edit their pitch centers, retune speeds, and formants, and hear those corrections applied in real-time through the Rust/WASM DSP engine without artifacts, phase smearing, or latency issues.

## Current State
The Knead plugin is structurally disconnected between the frontend and the DSP engine. The UI expects an offline analysis pipeline to populate a store of editable `NoteBlob`s, while the DSP engine is built as a real-time effect that only processes incoming audio block-by-block without exposing any pitch data back to the JS layer. Furthermore, the underlying DSP implementation (PSOLA) is mathematically flawed when applied to block-based real-time processing, guaranteeing severe audio artifacts. The plugin is currently non-functional for end users.

## Priorities
1. **Bridge the Architecture Gap**: Implement offline analysis to extract pitch contours and send them to the UI, while keeping the real-time engine for applying the playback shifts.
2. **Fix PSOLA Artifacts**: Rewrite the real-time pitch shifting to properly handle inter-block overlapping and use true synchronous pitch marks.
3. **Wire DSP Parameters**: Connect UI parameters (retune speed, shift, formants) to the DSP engine.
4. **Fix Stereo Processing**: Ensure Knead processes both left and right channels properly (or mixes down to mono safely).
5. **Implement UI Editing**: Add mouse event handlers to the `<canvas>` so users can actually modify the pitch of the blobs.

## Findings

### Architectural Disconnect
The fundamental design of the plugin is split between two conflicting paradigms. The frontend (`KneadEditor.tsx` and `kneadStore.ts`) expects to receive a complete array of `NoteBlob`s representing the entire audio clip via `ingestDspAnalysis()`. However, the Rust DSP (`KneadEngine` and `KneadInstance`) operates exclusively as a real-time insert effect, processing 4096-sample blocks. It does not perform a full-file analysis, nor does it expose its `current_f0` or pitch contours to the WASM bindings. Consequently, the UI infinitely spins on "Analyzing pitch tracking data..." because no data ever arrives.

### Real-Time PSOLA Failure
`KneadEngine` attempts to perform Pitch-Synchronous Overlap-Add (PSOLA) inside its `process_analysis_frame` function. It accumulates frames up to 2048 samples and then calls `psola_process_offline()`. This approach is critically broken:
- `psola_process_offline` truncates the output to the exact length of the input chunk, discarding the overlapping "tails" of the synthesized grains. This causes severe discontinuities (clicks) at every block boundary.
- The `pitch_marks` passed to the PSOLA function are synthetically generated (`p += period`) starting from `0` in each block. PSOLA requires pitch marks to be aligned with the actual glottal pulses of the audio signal. Synthetic marks cause phase cancellation, smearing, and "robotic" artifacts.

### Missing Parameter Wiring
The UI exposes `retuneSpeedMs`, `humanizePercent`, and `formantPreserve` in `KneadEditor.tsx`, and stores them in `kneadStore.ts`. However:
- None of these parameters are sent to the DSP engine.
- `KneadEngine` only has a `shift_semitones` field, which is hardcoded to `0.0` and never mutated.
- Formant preservation is entirely missing from the DSP; the current PSOLA implementation merely resamples grains, which shifts the spectral envelope along with the pitch (the "chipmunk" effect).

### Stereo Field Destruction
In `crates/daw-engine/src/scheduler.rs`, the `AudioScheduler::process_block` method calls `engine.process_analysis_frame(left);` for `PluginCore::Knead`. The right channel is completely ignored. Additionally, `KneadInstance` in WASM only allocates a `left_buf`. This results in the left channel being processed (or muted/distorted by the broken PSOLA) while the right channel remains completely dry, destroying the stereo image.

### Canvas UI Incompleteness
The `<canvas>` rendering in `KneadEditor.tsx` maps `NoteBlob` data to screen coordinates, drawing horizontal boxes and pitch curves. However, the canvas only possesses a `cursor-crosshair` class and entirely lacks mouse event listeners (`onMouseDown`, `onMouseMove`, `onMouseUp`). It is a read-only display pretending to be an editor.

## Issues

### 1. Offline Analysis Pipeline is Missing
- **Severity**: Critical
- **Evidence**: `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx` logs a warning that "Real DSP pitch analysis is not wired up yet". `ingestDspAnalysis` in `src/modules/Knead/useCases/dspAnalysis.ts` is never invoked.
- **Impact**: The plugin cannot display any pitch data to the user.
- **Needed**: Implement an offline analysis task in a Web Worker or Rust WASM module that reads the full audio buffer of a clip, runs the YIN algorithm, segments the results into `NoteBlob`s, and dispatches them to `ingestDspAnalysis`.

### 2. Block-Based PSOLA Causes Severe Artifacts
- **Severity**: Critical
- **Evidence**: `crates/daw-dsp/src/knead/engine.rs` calls `psola_process_offline()` on 2048-sample chunks and throws away overlapping grain tails. Pitch marks are generated as `p += period`.
- **Impact**: Audio played through Knead will be riddled with clicks, pops, and phase smearing.
- **Needed**: Rewrite `KneadEngine`'s real-time pitch shifter. It must maintain an internal ring buffer to handle overlapping grains across block boundaries. It must also implement an epoch-tracking algorithm (e.g., peak picking around the estimated F0) to find true synchronous pitch marks, rather than synthesizing them.

### 3. UI Parameters Are Not Sent to DSP
- **Severity**: High
- **Evidence**: `KneadEditor.tsx` updates `kneadStore` for Retune, Humanize, and Formants, but these values never cross the WASM/Rust boundary. `KneadEngine` lacks fields for them.
- **Impact**: User adjustments in the UI have no effect on the audio.
- **Needed**: Add parameter setter methods to `KneadInstance` in `crates/daw-dsp/src/knead/mod.rs` and `KneadEngine`. Update `AudioScheduler` to handle `GraphCommand::SetParam` for Knead. Write a sync function in JS to push `kneadStore` changes to the audio engine.

### 4. Right Channel is Ignored
- **Severity**: High
- **Evidence**: `crates/daw-engine/src/scheduler.rs` lines 180-182 only pass the `left` buffer to `engine.process_analysis_frame()`.
- **Impact**: Stereo audio clips will have a pitch-shifted left channel and an unprocessed right channel.
- **Needed**: Modify `KneadEngine::process_analysis_frame` to process stereo audio (either dual-mono processing or mid/side). Update `AudioScheduler` to pass both `left` and `right` slices.

### 5. UI is Read-Only
- **Severity**: High
- **Evidence**: `KneadEditor.tsx` `<canvas>` has no pointer event handlers.
- **Impact**: Users cannot edit the pitch of the analyzed blobs.
- **Needed**: Add pointer event tracking to the canvas to detect clicks on blobs, allow vertical dragging to snap to semitones (updating `pitchCenterCents`), and dispatch the updated blob state to `kneadStore` (which must then send the target pitch curve to the DSP).

### 6. Inefficient YIN Implementation
- **Severity**: Medium
- **Evidence**: `crates/daw-dsp/src/knead/yin.rs` uses a nested loop for the difference function `O(N * tau_max)`.
- **Impact**: High CPU usage per frame, limiting the number of Knead instances that can run simultaneously.
- **Needed**: Replace the time-domain difference function with an FFT-based auto-correlation approach, or switch to the McLeod Pitch Method (MPM) which is generally faster and more robust for real-time applications.

### 7. Memory Leak in Store
- **Severity**: Medium
- **Evidence**: `src/modules/Knead/stores/kneadStore.ts` does not provide a mechanism to remove tracks from `tracks: Record<string, KneadTrackState>`.
- **Impact**: Deleting a track or removing the Knead device leaves megabytes of blob data in memory.
- **Needed**: Implement a `removeTrackKneadState` function in `kneadStore.ts` and call it when the Knead device is removed from a track's device chain.

## Risks
- **Correctness**: The current PSOLA implementation is mathematically unsound for real-time chunked processing. If released, it will severely corrupt user audio.
- **Performance**: Running heavy O(N^2) YIN analysis synchronously on the audio thread for every Knead instance will cause underruns (crackling) on lower-end machines or dense projects.

## Suggested Approaches
- **Analysis Separation**: Decouple analysis from playback. When Knead is enabled on a clip, spawn a Web Worker that runs YIN/MPM over the entire audio buffer offline, generates `NoteBlob`s, and saves them to the store.
- **Real-Time Playback**: The real-time `KneadEngine` should only perform pitch shifting. It should receive a time-stamped "target pitch curve" or specific shift commands from the JS sequencer, and use a robust, stateful pitch shifter (like a phase vocoder or a properly ring-buffered PSOLA) to process the audio, skipping the expensive YIN analysis during playback entirely.
- **Formant Preservation**: If true formant preservation is required, consider migrating the pitch shifting backend to a phase vocoder or a specialized library, as pure PSOLA requires complex spectral envelope extraction and re-application to preserve formants independently of pitch.

## Resolved
- *(None yet. Initial audit.)*
