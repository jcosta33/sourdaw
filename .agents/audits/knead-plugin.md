# Knead Plugin End-to-End Audit

## Goal
The Knead plugin aims to provide a professional-grade, real-time pitch correction and editing experience (similar to Melodyne or Auto-Tune). The system must allow the user to view analyzed pitch contours ("blobs") in the UI, edit their pitch centers, retune speeds, and formants, and hear those corrections applied in real-time through the Rust/WASM DSP engine without artifacts, phase smearing, or latency issues.

## Current State
The Knead plugin is structurally disconnected between the frontend and the DSP engine. The UI expects an offline analysis pipeline to populate a store of editable `NoteBlob`s, while the DSP engine is built as a real-time effect that only processes incoming audio block-by-block without exposing any pitch data back to the JS layer. Furthermore, the underlying DSP implementation (PSOLA) is mathematically flawed when applied to block-based real-time processing, guaranteeing severe audio artifacts. The plugin is currently non-functional for end users.

## Priorities
1. **Bridge the Architecture Gap**: Implement offline analysis to extract pitch contours and send them to the UI, while keeping the real-time engine for applying the playback shifts.
2. **Fix PSOLA Artifacts**: Rewrite the real-time pitch shifting to properly handle inter-block overlapping and use true synchronous pitch marks.
3. **Establish Pitch Control API**: Rewrite `KneadEngine` to accept time-varying pitch target curves from the JS layer, rather than a static shift amount.
4. **Wire DSP Parameters**: Connect UI parameters (retune speed, humanize, formants) to the DSP engine.
5. **Fix Stereo Processing**: Ensure Knead processes both left and right channels properly.
6. **Implement UI Editing & Sync**: Add mouse event handlers to the `<canvas>`, and sync its rendering/zoom/playhead to the DAW's global timeline state.
7. **Implement Persistence**: Save the user's manual pitch edits (`NoteBlob`s) to the project schema so they are not lost on reload.

## Findings

### Architectural Disconnect
The fundamental design of the plugin is split between two conflicting paradigms. The frontend (`KneadEditor.tsx` and `kneadStore.ts`) expects to receive a complete array of `NoteBlob`s representing the entire audio clip via `ingestDspAnalysis()`. However, the Rust DSP (`KneadEngine` and `KneadInstance`) operates exclusively as a real-time insert effect, processing 4096-sample blocks. It does not perform a full-file analysis, nor does it expose its `current_f0` or pitch contours to the WASM bindings. Consequently, the UI infinitely spins on "Analyzing pitch tracking data..." because no data ever arrives.

### Real-Time PSOLA Failure
`KneadEngine` attempts to perform Pitch-Synchronous Overlap-Add (PSOLA) inside its `process_analysis_frame` function. It accumulates frames up to 2048 samples and then calls `psola_process_offline()`. This approach is critically broken:
- `psola_process_offline` truncates the output to the exact length of the input chunk, discarding the overlapping "tails" of the synthesized grains. This causes severe discontinuities (clicks) at every block boundary.
- The `pitch_marks` passed to the PSOLA function are synthetically generated (`p += period`) starting from `0` in each block. PSOLA requires pitch marks to be aligned with the actual glottal pulses of the audio signal. Synthetic marks cause phase cancellation, smearing, and "robotic" artifacts.

### DSP Lacks Time-Varying Pitch Control
Even if parameters were wired from the UI, `KneadEngine` is completely incapable of receiving dynamic pitch correction curves. It calculates its shift using a static scalar: `let target_f0 = f0 * 2.0_f32.powf(self.shift_semitones / 12.0);` and generates a flat target curve (`vec![target_f0; self.in_buffer.len()]`). There is no mechanism for the Javascript sequencer to send the user's time-stamped pitch curve edits down to the engine.

### Missing Parameter Wiring & Formant Preservation
The UI exposes `retuneSpeedMs`, `humanizePercent`, and `formantPreserve` in `KneadEditor.tsx`, and stores them in `kneadStore.ts`. However:
- None of these parameters are sent to the DSP engine.
- Formant preservation is entirely missing from the DSP; the current PSOLA implementation merely resamples grains, which shifts the spectral envelope along with the pitch (the "chipmunk" effect).
- The `KneadInstance` WASM bindings (`crates/daw-dsp/src/knead/mod.rs`) are completely dead code; `AudioScheduler` instantiates `KneadEngine` directly, meaning the WASM wrappers aren't even used.

### Stereo Field Destruction
In `crates/daw-engine/src/scheduler.rs`, the `AudioScheduler::process_block` method calls `engine.process_analysis_frame(left);` for `PluginCore::Knead`. The right channel is completely ignored. This results in the left channel being processed (or muted/distorted by the broken PSOLA) while the right channel remains completely dry, destroying the stereo image.

### Canvas UI Incompleteness & Timeline Disconnect
The `<canvas>` rendering in `KneadEditor.tsx` maps `NoteBlob` data to screen coordinates, drawing horizontal boxes and pitch curves. However:
- The canvas entirely lacks pointer event handlers (`onMouseDown`, `onMouseMove`, `onMouseUp`). It is a read-only display.
- Zoom is hardcoded to a static 300 pixels per second (`const x = blob.startTime * 300;`). It does not subscribe to the global timeline zoom, so long clips will stretch arbitrarily off-screen with no way to navigate them.
- There is no playhead drawn, leaving the user with zero context of where playback currently is.

### Audio Thread Allocations (Hard Rule Violation)
The `KneadEngine` performs significant dynamic memory allocations during its real-time `process_analysis_frame` and `psola_process_offline` execution. This includes creating `Vec::with_capacity(100)`, initializing new vectors (`vec![target_f0; len]`), and calling `hann_window(grain_len)` which allocates a brand new `Vec<f32>` for every single audio grain processed. This violates the strict "Audio thread: no allocation" rule in `AGENTS.md` and guarantees real-time audio dropouts and crackling during playback.

### Data Coupling: Pitch Data Bound to Track instead of Clip
Pitch correction data is modeled globally on the Track (`KneadTrackState`), but the user conceptually edits pitch for a *Clip* (an audio region). If a user edits pitch contours, and then later cuts, moves, or loops the audio clip in the arrangement timeline, the pitch correction blobs remain static at their original absolute track times, completely destroying the timing of the correction. Pitch blobs must be structurally bound to the Clip document, not the Track.

### Inaccessible UI Design
The pitch editor is entirely visually driven via an HTML `<canvas>`, providing zero fallbacks for screen readers. A visually impaired user cannot view or edit pitch contours, or even navigate between analyzed `NoteBlob`s using a keyboard.

### Volatile Store State (No Persistence)
`kneadStore` manages `tracks: Record<string, KneadTrackState>`, which holds the user's manual pitch edits, retune speed, and tolerance parameters. None of this data is integrated into the Automerge multi-document model (`crates/daw-collab/src/schema.rs` and `src/modules/Project/useCases/projectPersistence`). If a user edits a vocal track and reloads the project, all edits are permanently lost.

### Complete Lack of DSP Testing
There is exactly zero test coverage for the Knead Rust backend (`crates/daw-dsp/src/knead`). Essential algorithms like YIN pitch detection, Voice/Unvoiced gating, and PSOLA are highly complex mathematical procedures that require isolated unit tests against sine waves or known audio signals.

### Shared YIN Dependency in Sampler
The Sampler module's pitch detection (`crates/daw-dsp/src/sampler/analysis/pitch.rs`) directly imports and uses Knead's `yin_frame` algorithm. Any performance optimizations or accuracy fixes applied to YIN for Knead will inadvertently impact sampler slice analysis.

### DSP CPU Burn (Always-On Processing)
Because `KneadEngine`'s `shift_semitones` is hardcoded to `0.0`, the PSOLA routine correctly avoids running when bypassed. However, the expensive O(N^2) YIN periodicity check (`yin_frame`) runs on *every single incoming block*, even if the user hasn't enabled pitch correction, burning DSP thread CPU for nothing.

## Issues

### 1. Offline Analysis Pipeline is Missing
- **Severity**: Critical
- **Evidence**: `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx` logs a warning that "Real DSP pitch analysis is not wired up yet".
- **Impact**: The plugin cannot display any pitch data to the user.
- **Needed**: Implement an offline analysis task in a Web Worker or Rust WASM module that reads the full audio buffer of a clip, runs the YIN algorithm, segments the results into `NoteBlob`s, and dispatches them to `ingestDspAnalysis`.

### 2. Block-Based PSOLA Causes Severe Artifacts
- **Severity**: Critical
- **Evidence**: `crates/daw-dsp/src/knead/engine.rs` calls `psola_process_offline()` on 2048-sample chunks and throws away overlapping grain tails.
- **Impact**: Audio played through Knead will be riddled with clicks, pops, and phase smearing.
- **Needed**: Rewrite `KneadEngine`'s real-time pitch shifter. It must maintain an internal ring buffer to handle overlapping grains across block boundaries. It must also implement an epoch-tracking algorithm (e.g., peak picking around the estimated F0) to find true synchronous pitch marks.

### 3. DSP Lacks Time-Varying Pitch Target API
- **Severity**: Critical
- **Evidence**: `KneadEngine::process_analysis_frame` relies on a static `shift_semitones` field and synthesizes a flat `target_f0_curve`.
- **Impact**: The DSP engine cannot apply the manual pitch edits the user makes in the UI.
- **Needed**: Modify `KneadEngine` to accept a continuous parameter stream or an array of active `NoteBlob` bounds + curves from the `AudioScheduler`, and interpolate these targets dynamically during block processing.

### 4. Audio Thread Allocations
- **Severity**: Critical
- **Evidence**: `crates/daw-dsp/src/knead/engine.rs` uses `vec!` and `Vec::with_capacity`. `psola_process_offline` calls `hann_window()` which creates a new `Vec<f32>` per grain.
- **Impact**: Guaranteed audio dropouts, violating the hard rule "Audio thread: no allocation".
- **Needed**: Pre-allocate all working memory (including grain windows) in `KneadEngine::new()`. Pass mutable slice references `&mut [f32]` for intermediate calculations instead of returning new `Vec`s.

### 5. Pitch Data Bound to Track instead of Clip
- **Severity**: Critical
- **Evidence**: `KneadTrackState` in `src/modules/Knead/models/KneadBlob.ts` is bound to `trackId`.
- **Impact**: If a user cuts, moves, or loops an audio clip in the arrangement, the pitch edits will not follow the audio, ruining the vocal timing.
- **Needed**: Refactor `kneadStore.ts` to map pitch data to `clipId` instead of `trackId`. `KneadEditor.tsx` must receive `clipId` as a prop and offset the drawing of the blobs by the clip's local timeline offset.

### 6. UI Parameters Are Not Sent to DSP
- **Severity**: High
- **Evidence**: `KneadEditor.tsx` updates `kneadStore` but the values never cross the FFI boundary. `KneadInstance` in WASM is dead code.
- **Impact**: Retune Speed, Humanize, and Formants UI sliders do nothing.
- **Needed**: Add parameter setter commands to `GraphCommand` in `AudioScheduler`, implement the corresponding DSP parameters in `KneadEngine`, and write the JS sync logic.

### 7. Right Channel is Ignored
- **Severity**: High
- **Evidence**: `crates/daw-engine/src/scheduler.rs` lines 180-182 only pass the `left` buffer.
- **Impact**: Stereo audio clips will have a pitch-shifted left channel and an unprocessed right channel.
- **Needed**: Modify `KneadEngine::process_analysis_frame` to process stereo audio (either dual-mono processing or mid/side) and pass both buffers.

### 8. UI is Read-Only and Disconnected from Timeline
- **Severity**: High
- **Evidence**: `KneadEditor.tsx` `<canvas>` has no pointer event handlers and hardcodes `blob.startTime * 300` for X-axis scaling.
- **Impact**: Users cannot edit pitch blobs, zoom horizontally, or see the playhead.
- **Needed**: Add pointer event tracking to allow vertical dragging to snap to semitones. Subscribe to the global timeline zoom scale and scroll offset to calculate the X position. Subscribe to the playback transport state to draw a vertical playhead line.

### 9. Pitch Edits Are Not Persisted
- **Severity**: High
- **Evidence**: `crates/daw-collab/src/schema.rs` has no keys for Knead data. `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts` clears it, but no serialization exists.
- **Impact**: Manual pitch correction work is instantly destroyed upon closing the browser.
- **Needed**: Extend `schema.rs` with `KEY_KNEAD_BLOBS`. Update `saveProject` and `loadProject` to serialize and deserialize `KneadTrackState` (or `KneadClipState` after refactoring).

### 10. Missing MIDI Input (Vocoder Mode)
- **Severity**: Medium
- **Evidence**: `AudioScheduler` processes `pending_midi` for `PluginCore::Native` but skips it for `PluginCore::Knead`.
- **Impact**: The plugin cannot be "played" via MIDI, omitting a standard feature of modern pitch correctors.
- **Needed**: Pass `pending_midi` to `KneadEngine` and implement a mode where active MIDI notes override the `target_f0`.

### 11. Memory Leak in Store
- **Severity**: Medium
- **Evidence**: `src/modules/Knead/stores/kneadStore.ts` does not provide a mechanism to remove tracks from `tracks`.
- **Impact**: Deleting a track or removing the Knead device leaves megabytes of blob data in memory.
- **Needed**: Implement a `removeClipKneadState` function in `kneadStore.ts`.

### 12. Missing DSP Tests
- **Severity**: Medium
- **Evidence**: `grep` confirms `cfg(test)` is absent from `crates/daw-dsp/src/knead`.
- **Impact**: It is nearly impossible to refactor the broken PSOLA implementation with confidence.
- **Needed**: Write unit tests in `crates/daw-dsp/src/knead` covering YIN periodicity detection accuracy, `is_voiced` thresholding, and PSOLA single-grain reconstruction.

### 13. Inefficient YIN Implementation
- **Severity**: Medium
- **Evidence**: `crates/daw-dsp/src/knead/yin.rs` uses a nested loop for the difference function `O(N * tau_max)`.
- **Impact**: High CPU usage per frame, limiting the number of Knead instances that can run simultaneously.
- **Needed**: Replace the time-domain difference function with an FFT-based auto-correlation approach, or switch to the McLeod Pitch Method (MPM) which is generally faster and more robust for real-time applications. Ensure the Sampler module (`sampler/analysis/pitch.rs`) is updated or decoupled as necessary.

### 14. Accessibility (a11y) Barriers
- **Severity**: Medium
- **Evidence**: `KneadEditor.tsx` `<canvas>` lacks ARIA roles, tabindex, or keyboard navigation fallbacks for the visual blobs.
- **Impact**: The pitch editing workflow is inaccessible to screen-reader users and keyboard-only users.
- **Needed**: Provide a keyboard-navigable list (e.g., a hidden DOM overlay or a toggleable list view) of the `NoteBlob`s, allowing users to tab through them and adjust `pitchCenterCents` using arrow keys.

## Risks
- **Correctness**: The current PSOLA implementation is mathematically unsound for real-time chunked processing. If released, it will severely corrupt user audio.
- **Performance**: The combination of O(N^2) YIN analysis and dynamic memory allocations on the audio thread will cause immediate CPU overloads and audio dropouts, rendering the DAW unusable.
- **Data Loss**: The lack of persistence means the plugin is fundamentally unusable for actual project work.
- **User Trust**: The detachment of pitch correction blobs from the underlying Clip timeline means any arrangement edits will silently destroy the user's vocal tuning sync, eroding trust in the software.

## Suggested Approaches
- **Analysis Separation**: Decouple analysis from playback. When Knead is enabled on a clip, spawn a Web Worker that runs YIN/MPM over the entire audio buffer offline, generates `NoteBlob`s, and saves them to the store.
- **Real-Time Playback**: The real-time `KneadEngine` should only perform pitch shifting. It should receive a time-stamped "target pitch curve" or specific shift commands from the JS sequencer, and use a robust, stateful pitch shifter (like a phase vocoder or a properly ring-buffered PSOLA) to process the audio, skipping the expensive YIN analysis during playback entirely.
- **Formant Preservation**: If true formant preservation is required, consider migrating the pitch shifting backend to a phase vocoder or a specialized library, as pure PSOLA requires complex spectral envelope extraction and re-application to preserve formants independently of pitch.
- **Persistence**: Store the `NoteBlob` array either as an opaque JSON string per clip in Automerge, or as discrete Yjs/Automerge List elements if real-time multi-user editing of pitch blobs is a strict requirement. (JSON blob is recommended for MVP to avoid syncing thousands of individual pitch contour data points).

## Resolved
- *(None yet. Initial audit.)*

## Verification notes (2026-04-14)

### Pass 2

| Claim | Check |
|--------|--------|
| Scheduler only `left` | **Confirmed** — `daw-engine/src/scheduler.rs` ~177–178 `process_analysis_frame(left)` only. |
| Static shift + flat target curve | **Confirmed** — `knead/engine.rs` ~80–90 `target_f0 = f0 * 2^...`, ~91 `vec![target_f0; self.in_buffer.len()]`, `Vec::with_capacity(100)` for pitch marks. |
| YIN every block when voiced + shift | **Confirmed** — `process_analysis_frame` pushes samples until frame_size, runs `yin_frame`, builds `pitch_marks` vec, `psola_process_offline` when `shift_semitones != 0`. |
| `shift_semitones` default 0 | **Confirmed** — `engine.rs` ~44 `shift_semitones: 0.0` skips PSOLA branch when shift is zero (but YIN still runs when buffer full). |
| KneadEditor warning | **Spot-check** — grep `KneadEditor` for analysis message when validating UX. |

### Gaps
- `knead/mod.rs` WASM path vs `daw-engine` scheduler — confirm no duplicate entry points.
- A11y / schema / persistence — still open from main audit body.

### Pass 3 (2026-04-14) — UI strings + PSOLA + YIN cost

| Claim | Result |
|--------|--------|
| **KneadEditor “not wired”** | **Confirmed** — `KneadEditor.tsx` ~27–35 `console.warn` + `Real DSP pitch analysis is not wired up yet...`; UI still shows “Analyzing pitch tracking data...” (~218) when `isAnalyzing`. |
| **`hann_window` per grain** | **Confirmed** — `psola.rs` ~52 calls `hann_window(grain_len)` inside PSOLA path; `utils.rs` allocates new `Vec<f32>`. |
| **Static `target_f0` curve** | **Re-confirmed** — `engine.rs` ~90–91 `vec![target_f0; self.in_buffer.len()]`. |
| **YIN when `shift_semitones == 0`** | **Confirmed** — `process_analysis_frame` runs `yin_frame` whenever `in_buffer.len() >= frame_size` (~60–67) **before** the `voiced && shift_semitones != 0.0` branch (~80); expensive analysis still runs when shift is zero. |
