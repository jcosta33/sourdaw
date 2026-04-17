# Clip Pitch Editing

## Context

Users expect instant analysis, inline blobs overlaid on the waveform, real-time audible preview without rendering, and an optional "bounce in place" for CPU relief. Logic's Flex Pitch is the gold standard for this UX. We are building a custom React/Rust pitch editor rather than using an ARA 2 host implementation, as the custom approach delivers faster time-to-market, tighter UX integration, and eliminates GPL/commercial licensing dependencies on third-party plugins.

Reference relevant research: `.agents/research/factory/active/clip-pitch-editing.md`

---

## Goal

Deliver a Logic Flex Pitch–quality inline pitch editing experience for monophonic audio clips within 8-12 weeks, featuring a custom React/Rust architecture with a triple-buffer IPC pipeline for low-latency real-time preview and non-destructive background commit.

---

## User-visible behavior

- Users can enable pitch editing on a monophonic audio clip directly from the timeline.
- Pitch analysis runs automatically; upon completion, inline note blobs appear overlaid on the waveform in the clip editor.
- Blobs feature six draggable hotspots — pitch drift start, pitch drift end, vibrato depth, gain, fine pitch, and formant shift — each of which corresponds 1:1 to a serialized field on `NoteSegment` (see Requirement 2).
- Users can drag blobs and hotspots to non-destructively adjust pitch parameters.
- Edits are audible in real-time during playback with extremely low latency (no rendering required for preview).
- Moving or trimming the clip on the timeline does not invalidate the pitch edits.
- Users can choose to "freeze" or "commit" the pitch edits, triggering a background offline render that replaces the live processing with a rendered file for CPU relief. Unfreezing seamlessly restores the live editable state.

---

## Scope

**In scope:**

- Monophonic vocal and instrument pitch correction.
- pYIN-based offline pitch analysis.
- TD-PSOLA (Time-Domain Pitch Synchronous Overlap and Add) based real-time pitch synthesis in the Rust audio thread.
- Triple-buffer lock-free IPC pipeline for transmitting pitch edit delta maps from React to Rust.
- Inline React UI for visualizing and editing pitch blobs over waveforms.
- Non-destructive playback of edits.
- Background offline rendering (Bounce/Freeze) of pitch edits.
- Undo/redo of pitch edits using the Command pattern.

**Non-goals (explicitly out of scope):**

- Polyphonic pitch editing (e.g., Melodyne DNA style).
- ARA 2 host implementation (deferred to a future Phase 2).
- Phase vocoder based time-stretching (PSOLA is used exclusively).
- VST3/CLAP pitch plugin integration.

---

## Requirements

1. **Analysis Pipeline** — The frontend MUST invoke a `analyze_pitch` Tauri command with the region ID. Rust MUST process the audio file using the `pyin` algorithm on a Tokio thread pool, streaming partial progress back via a `Channel<AnalysisProgress>`. The command MUST return a `PitchContour` containing:
    - `points: Vec<PitchPoint>` (time_ms, frequency_hz, confidence, voiced)
    - `sample_rate: u32`
    - `hop_size: u32`
    - `algorithm: String` ("pyin" | "crepe")
2. **Data Structure** — Pitch edit commands (`PitchEditCommand`) sent to Rust MUST contain a `region_id` and a `segments: Vec<NoteSegment>`. Each `NoteSegment` MUST include one serialized field per draggable UI hotspot (see Requirement 7):
    - `start_ms`, `end_ms`
    - `detected_pitch_hz` (from analysis) and `target_pitch_hz` (coarse, semitone-quantized target)
    - `fine_pitch_cents` (fine pitch offset in cents, applied on top of `target_pitch_hz`; independent of coarse target so a user can nudge a note ±50 ¢ without changing its nominal semitone)
    - `pitch_drift_in`, `pitch_drift_out` (in cents)
    - `vibrato_depth` (0.0–1.0 scale factor)
    - `gain` (linear amplitude factor, range `0.0`–`4.0`, corresponding to roughly -∞…+12 dB)
    - `formant_shift_cents`
    Every draggable hotspot in the UI (Requirement 7) MUST map 1:1 to one of the fields above. Adding a new hotspot without adding the corresponding field is a spec violation.
3. **IPC Performance** — The React UI MUST debounce drag edits at ~60 Hz. The Rust command handler MUST compile segments into a `CompiledDeltaMap` (pre-interpolated per-hop pitch ratios) and publish it via a `triple_buffer` reader. End-to-end latency from drag to audible change MUST land at 7-13ms (1-2ms IPC + <1ms triple buffer + 5-10ms audio buffer).
4. **Synthesis Engine** — The Rust audio thread MUST implement TD-PSOLA for pitch shifting. The implementation MUST:
    - Detect pitch marks aligned with waveform peaks.
    - Extract windowed grains (2× pitch period, Hann windowed) centered at marks.
    - Reposition marks at the target pitch period (delta-map ratio).
    - Overlap-add grains into the output buffer.
5. **Background Commit** — When a user freezes/commits, Rust MUST spawn a dedicated OS thread (`std::thread::spawn`, not Tokio) to apply offline PSOLA. The system MUST use an `AtomicBool` flag and a 2-4ms crossfade to seamlessly swap the region's playback source from live processing to the rendered file.
    - **Cleanup**: A background routine MUST purge orphaned rendered files in the `rendered/` directory upon project save or manual cleanup.
6. **Undo/Redo** — The system MUST implement a `Command` pattern. `CommitRegionCommand` MUST store the `original_source` (reference preserved), the `delta_map_snapshot` (parameters), and the `rendered_file` path. Undoing a commit MUST restore the original source reference and re-activate live PSOLA.
7. **UI Integration** — The pitch editor MUST render inline note blobs on a Canvas/WebGL grid directly over the audio waveform. Each blob MUST expose exactly 6 draggable hotspots, each bound to the corresponding `NoteSegment` field (Requirement 2):
    - Pitch drift start → `pitch_drift_in`
    - Pitch drift end → `pitch_drift_out`
    - Vibrato depth → `vibrato_depth`
    - Gain → `gain`
    - Fine pitch → `fine_pitch_cents`
    - Formant → `formant_shift_cents`
    The body of the blob itself is draggable vertically to set `target_pitch_hz` (coarse pitch) and horizontally to set `start_ms`/`end_ms`.
8. **High-Accuracy Mode (Optional)** — The system MUST support a CREPE neural network fallback via the `ort` crate (ONNX Runtime bindings), loading pre-exported models to achieve ~97.8% Raw Pitch Accuracy.
9. **PSOLA Quality Cap** — Because TD-PSOLA degrades audibly beyond roughly ±700 cents of shift (per research), the effective shift applied to any `NoteSegment` (sum of `target_pitch_hz` offset from `detected_pitch_hz` plus `fine_pitch_cents`) MUST be clamped to `[-700, +700]` cents in the delta-map compiler. When the user drags a blob past the cap, the UI MUST (a) visually indicate the cap (blob hotspot styling) and (b) refuse to send out-of-range values to Rust. The clamp MUST be applied in `CompiledDeltaMap` construction, not only in the UI, so any command path (undo/redo, AI-generated edit, serialized project file) cannot exceed it.
10. **Real-Time Audio Safety (rtrb)** — Pre-buffered PCM flowing from the disk/decoder thread into the audio callback MUST use an `rtrb` lock-free SPSC ring buffer. The audio thread MUST NOT allocate, lock a mutex, call `std::sync::RwLock::{read,write}`, call `Mutex::lock`, or invoke any blocking syscall on the PSOLA/playback path. Parameter updates from the UI MUST flow exclusively through the `triple_buffer` reader created in Requirement 3. This is a hard RT-safety requirement, not a performance tip; violations are failures of this spec.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- The audio thread must NEVER allocate, lock mutexes, or block. `rtrb` is the sole PCM transport and `triple_buffer` is the sole parameter transport (see Requirements 3 and 10).
- Must not use any GPL-licensed libraries (e.g., Rubber Band Library).
- PSOLA pitch shift is clamped to ±700 cents (Requirement 9); the spec does not define behavior outside that range beyond "UI must prevent it and the delta-map compiler must enforce it".

---

## Design decisions

### Decision: Pitch Synthesis Algorithm

**Chosen:** Custom TD-PSOLA in Rust.
**Justification:** PSOLA inherently preserves formants (shifting pitch without moving vocal tract resonances) and offers significantly lower latency (~5–20 ms) than phase vocoders.
**Considered and rejected:** Phase vocoding (requires separate formant correction, higher latency). Rubber Band Library (GPL v2 license). ARA 2 (Phase 2 goal, high testing risk).

### Decision: Threading Model

**Chosen:** Four-thread architecture with lock-free bridges.

1. **Analysis Thread (Tokio):** Offline pYIN/CREPE processing.
2. **Edit Thread (IPC/Main):** UI interactions and delta-map compilation.
3. **Audio Thread (RT):** Live TD-PSOLA synthesis (lock-free).
4. **Commit Thread (OS):** Background offline rendering to WAV.

### Decision: IPC Concurrency Model

**Chosen:** Lock-free triple buffer via the `triple_buffer` crate.
**Justification:** Decouples the 60 Hz IPC command handler from the 1000+ Hz audio callback with zero contention and zero allocation.

---

## Acceptance criteria

- [ ] After analysis completes, for each detected `NoteSegment` the UI renders a blob whose DOM/Canvas bounding box has:
    - horizontal extents matching `start_ms`/`end_ms` within ±1 CSS pixel of the waveform time-axis mapping,
    - vertical center matching `detected_pitch_hz` under the editor's log-frequency mapping within ±1 CSS pixel,
    - exactly 6 hotspot elements attached, each bound to the field listed in Requirement 7.
    Verified by a component test (`*.spec.tsx`) asserting on the rendered DOM/Canvas draw calls for a fixture `PitchContour`.
- [ ] Dragging a blob vertically emits a `PitchEditCommand` and produces an audibly updated audio output within **13 ms at the 95th percentile**, measured by an instrumented latency counter that records: `t0 = performance.now()` when the React drag handler enqueues the IPC call; `t1` in the Rust command handler when `triple_buffer::Input::write` returns; `t2` in the audio callback on the first callback that reads the new `CompiledDeltaMap` generation counter; `t3` when the enclosing output buffer is handed to CPAL. `t3 - t0` is the reported end-to-end latency. The test harness drives ≥ 1 000 drags at 60 Hz on the reference hardware (macOS, 128-frame audio buffer) and asserts p50 ≤ 8 ms, p95 ≤ 13 ms. Mic loopback verification is explicitly NOT required for this criterion.
- [ ] A static analysis check (CI-enforced, e.g. `cargo clippy` lint / `rg` rule / custom test) confirms the PSOLA processing path in `daw-dsp` and the audio callback in `daw-engine` contain zero occurrences of `Mutex::lock`, `RwLock::read`, `RwLock::write`, `parking_lot::Mutex::lock`, heap allocation macros (`vec!`, `Box::new`, `String::from`), or `.await`. The `rtrb` ring buffer is the sole PCM transport into the callback.
- [ ] A Rust unit test confirms `CompiledDeltaMap` construction clamps effective shift (coarse + fine) to `[-700, +700]` cents for every hop, regardless of input `NoteSegment` values.
- [ ] Committing a pitch edit writes a new WAV file to `<project>/rendered/<region_id>-<hash>.wav` and swaps playback via a 2–4 ms equal-power crossfade with zero sample discontinuity greater than 1 LSB at 24-bit (verified by an offline test that renders across the swap boundary).
- [ ] Undoing a commit restores the original source reference, re-activates live PSOLA, re-renders the editable blobs with the stored `segments` array, and does not delete the rendered WAV (it remains for redo).
- [ ] `pnpm deps:validate` passes with zero violations.

---

## Implementation notes

- **Pattern Survey Findings:**
    - **Similar implementations:** `src/modules/AudioAnalysis/useCases/pitchDetection.ts` uses McLeod Pitch Method (MPM). We depart to pYIN/CREPE for monophonic precision.
    - **Helpers to reuse:** `src/helpers/Store/` for state. `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` for Canvas rendering. `src/modules/Command/useCases/pushUndoEntry.ts` for Command pattern.
- **PSOLA Mechanics:** The algorithm (~500-1000 lines of Rust) will live in `daw-dsp` and utilize `rustfft` and `rtrb` for ring buffering pre-buffered PCM.
- **Data Volume:** 30s of pitch data is only ~41-82 KB, making JSON serialization over Tauri IPC efficient.

---

## Test plan

- [ ] Manual step: Load a vocal clip, enable pitch editing, drag a note up 2 semitones, and verify playback shifts pitch without moving formants.
- [ ] Manual step: Freeze the track, verify CPU usage drops, and audio plays identically. Undo the freeze, verify blobs become editable again.
- [ ] Automated: Unit tests in `daw-dsp` for the TD-PSOLA grain extraction and overlap-add logic.
- [ ] Automated: `pnpm deps:validate` to ensure no cross-module dependency violations.

---

## Open questions

- [ ] **[MINOR]** Should the CREPE ONNX model be bundled with the app installer, or downloaded on demand?
- [ ] **[MINOR]** What is the exact crossfade duration (e.g., 2-4ms) needed when atomically swapping between live PSOLA and committed frozen audio?
- [ ] **[MINOR]** Confirm the `gain` field range. Current spec says `0.0`–`4.0` linear (≈ -∞…+12 dB). Logic Flex Pitch exposes roughly ±12 dB; do we want a symmetric dB parameter instead of a linear factor for better UX/automation?
- [ ] **[MINOR]** Behavior at the ±700 cent cap (Requirement 9): hard stop at the cap, or allow the user to drag further with a visual warning while the engine internally clamps? Current spec mandates hard stop in the UI.
- [ ] **[MINOR]** Latency acceptance criterion targets macOS at a 128-frame buffer. Do we need equivalent thresholds for Windows (WASAPI) and Linux (ALSA/PipeWire), or is macOS the reference platform at launch?

---

## Tradeoffs and risks

- Building a custom PSOLA engine carries a risk of artifacting on complex vocal material compared to mature commercial algorithms like Melodyne. We mitigate this by supporting CREPE for high-quality analysis.
- Delaying ARA 2 support means we cannot support polyphonic editing (e.g. guitar chords) at launch. This is an accepted tradeoff for faster time-to-market and better UX integration.
