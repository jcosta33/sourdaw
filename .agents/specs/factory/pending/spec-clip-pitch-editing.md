# Clip Pitch Editing

## Context

Users expect instant analysis, inline blobs overlaid on the waveform, real-time audible preview without rendering, and an optional "bounce in place" for CPU relief. Logic's Flex Pitch is the gold standard for this UX. We are building a custom React/Rust pitch editor rather than using an ARA 2 host implementation, as the custom approach delivers faster time-to-market, tighter UX integration, and eliminates GPL/commercial licensing dependencies on third-party plugins.

Reference relevant research: `.agents/research/clip-pitch-editing.md`

---

## Goal

Deliver a Logic Flex Pitch–quality inline pitch editing experience for monophonic audio clips within 8-12 weeks, featuring a custom React/Rust architecture with a triple-buffer IPC pipeline for low-latency real-time preview and non-destructive background commit.

---

## User-visible behavior

- Users can enable pitch editing on a monophonic audio clip directly from the timeline.
- Pitch analysis runs automatically; upon completion, inline note blobs appear overlaid on the waveform in the clip editor.
- Blobs feature six draggable hotspots: pitch drift start, pitch drift end, vibrato depth, gain, fine pitch, and formant shift.
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
2. **Data Structure** — Pitch edit commands (`PitchEditCommand`) sent to Rust MUST contain a `region_id` and a `segments: Vec<NoteSegment>`. Each `NoteSegment` MUST include:
    - `start_ms`, `end_ms`
    - `detected_pitch_hz`, `target_pitch_hz`
    - `pitch_drift_in`, `pitch_drift_out` (in cents)
    - `vibrato_depth` (0.0–1.0 scale factor)
    - `formant_shift_cents`
3. **IPC Performance** — The React UI MUST debounce drag edits at ~60 Hz. The Rust command handler MUST compile segments into a `CompiledDeltaMap` (pre-interpolated per-hop pitch ratios) and publish it via a `triple_buffer` reader. End-to-end latency from drag to audible change MUST land at 7-13ms (1-2ms IPC + <1ms triple buffer + 5-10ms audio buffer).
4. **Synthesis Engine** — The Rust audio thread MUST implement TD-PSOLA for pitch shifting. The implementation MUST:
    - Detect pitch marks aligned with waveform peaks.
    - Extract windowed grains (2× pitch period, Hann windowed) centered at marks.
    - Reposition marks at the target pitch period (delta-map ratio).
    - Overlap-add grains into the output buffer.
5. **Background Commit** — When a user freezes/commits, Rust MUST spawn a dedicated OS thread (`std::thread::spawn`, not Tokio) to apply offline PSOLA. The system MUST use an `AtomicBool` flag and a 2-4ms crossfade to seamlessly swap the region's playback source from live processing to the rendered file.
    - **Cleanup**: A background routine MUST purge orphaned rendered files in the `rendered/` directory upon project save or manual cleanup.
6. **Undo/Redo** — The system MUST implement a `Command` pattern. `CommitRegionCommand` MUST store the `original_source` (reference preserved), the `delta_map_snapshot` (parameters), and the `rendered_file` path. Undoing a commit MUST restore the original source reference and re-activate live PSOLA.
7. **UI Integration** — The pitch editor MUST render inline note blobs on a Canvas/WebGL grid directly over the audio waveform. Each blob MUST feature 6 draggable hotspots: pitch drift start/end, vibrato, gain, fine pitch, and formant.
8. **High-Accuracy Mode (Optional)** — The system MUST support a CREPE neural network fallback via the `ort` crate (ONNX Runtime bindings), loading pre-exported models to achieve ~97.8% Raw Pitch Accuracy.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- The audio thread must NEVER allocate, lock mutexes, or block (use `rtrb` for audio and `triple_buffer` for parameters).
- Must not use any GPL-licensed libraries (e.g., Rubber Band Library).

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

- [ ] Pitch blobs render correctly over the waveform after analysis completes.
- [ ] Dragging a blob vertically shifts the target pitch and is audible within 7-13ms.
- [ ] The Rust audio thread contains zero `Mutex::lock` or `RwLock::read/write` calls in the pitch processing path.
- [ ] Committing a pitch edit writes a new WAV file to disk and seamlessly swaps playback via crossfade.
- [ ] Undoing a commit restores the editable blobs and live processing mode.
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

---

## Tradeoffs and risks

- Building a custom PSOLA engine carries a risk of artifacting on complex vocal material compared to mature commercial algorithms like Melodyne. We mitigate this by supporting CREPE for high-quality analysis.
- Delaying ARA 2 support means we cannot support polyphonic editing (e.g. guitar chords) at launch. This is an accepted tradeoff for faster time-to-market and better UX integration.
