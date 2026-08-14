---
type: spec
id: SPEC-clip-pitch-editing
title: Inline clip pitch editing (Knead)
status: in-progress
owner: The Sourdaw team
sources:
  - research.md
---

# Inline clip pitch editing (Knead)

## Intent

Give monophonic audio clips a Logic Flex Pitch–class inline editing surface: analysis runs
on enable, note blobs appear over the waveform, edits preview in real time without an
offline render, and a freeze step commits them for CPU relief — so a producer can correct
pitch without leaving the arrangement.

## Non-goals

- Polyphonic pitch editing (Melodyne DNA style).
- Hosting third-party ARA 2 pitch plugins.
- Phase-vocoder time-stretching — PSOLA is the synthesis path (PSOLA preserves formants; a phase vocoder shifts them with pitch, producing the "chipmunk effect" without a separate formant-correction stage).
- VST3/CLAP pitch-plugin integration.

## Requirements

### AC-001 — Audio path stays real-time safe

The live PSOLA playback path must perform no heap allocation, mutex lock, or blocking call,
with parameter updates arriving only through a lock-free triple buffer.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_edit`

### AC-002 — Pitch analysis returns a contour

When pitch editing is enabled on a monophonic clip, the engine must run pYIN analysis and
return a contour of points carrying time, frequency, confidence, and a voiced flag.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_edit`

### AC-016 — The contour carries sample rate, hop size, and analyzer identity

The returned `PitchContour` must carry, alongside its points, the `sample_rate` (`u32`), the
`hop_size` (`u32`), and an `algorithm` identifier whose value is one of `"pyin"` or
`"crepe"`, so a consumer can map a point's index to a sample offset and know which analyzer
produced it.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_edit`

### AC-017 — Analysis streams progress over a channel off the realtime path

When `analyze_pitch` is invoked with a region id, the engine must run pYIN on a background
(Tokio) thread pool and stream partial progress to the frontend through an
`AnalysisProgress` channel, returning the completed `PitchContour` as the command response —
analysis must never run on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-engine pitch_edit_latency`

### AC-003 — Inline blobs render over the waveform

When analysis completes, the editor must render one note blob per detected segment on a
Canvas/WebGL pitch-time grid overlaid on the waveform, aligned to the waveform time axis and
log-frequency mapping.

Verify with: `pnpm test:run -- PitchEditor`

### AC-004 — Each blob exposes six edit hotspots

Each blob must expose six draggable hotspots bound one-to-one to pitch drift in, pitch
drift out, vibrato depth, gain, fine pitch, and formant shift.

Verify with: `pnpm test:run -- PitchEditor`

### AC-005 — Edits preview in real time

When a blob is dragged, the engine must apply the change through live TD-PSOLA so it is
audible during playback with no render step.

Verify with: `manual` — drag a note up two semitones during playback and confirm an audible pitch change with formants held

### AC-006 — Shift is clamped in the delta-map compiler

The delta-map compiler must clamp effective shift to the range [-700, +700] cents for every
hop, regardless of which command path produced the edit.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_edit`

### AC-007 — Edits survive timeline moves

When a clip carrying pitch edits is moved or trimmed, its edits must remain bound to the
underlying audio.

Verify with: `pnpm test:run -- knead`

### AC-008 — Freeze commits to a rendered file

When the user freezes a region, the engine must render the edits to a new file at
`<project>/rendered/<region_id>-<hash>.wav` on a background thread and swap playback at the
boundary with a 2–4 ms equal-power crossfade, leaving no sample discontinuity greater than 1
LSB at 24-bit.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_edit`

### AC-018 — A local static-analysis gate forbids realtime-unsafe tokens on the audio path

A guarded static-analysis check must confirm that the PSOLA path in `daw-dsp` and
the audio callback in `daw-engine` contain zero occurrences of `Mutex::lock`,
`RwLock::read`/`RwLock::write`, `parking_lot::Mutex::lock`, the heap-allocation macros
`vec!`/`Box::new`/`String::from`, or `.await`.

Verify with: `pnpm cargo:test -- -p daw-engine pitch_edit_latency`

### AC-009 — Unfreeze restores live editing

When a commit is undone, the engine must restore live PSOLA with the stored segments and
re-editable blobs while keeping the rendered file for redo.

Verify with: `pnpm test:run -- knead`

### AC-010 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-011 — Orphaned rendered files are purged

A background routine must purge orphaned rendered files in the `rendered/` directory on
project save or on manual cleanup.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_edit`

### AC-012 — Drag-to-audible latency holds at p50 ≤ 8 ms, p95 ≤ 13 ms

Dragging a blob vertically must produce an audibly updated output within 13 ms at the 95th
percentile and 8 ms at the median, measured by an instrumented latency counter that records
`t0` when the React drag handler enqueues the IPC call, `t1` when the Rust command handler's
`triple_buffer::Input::write` returns, `t2` on the first audio callback that reads the new
`CompiledDeltaMap` generation, and `t3` when the output buffer is handed to CPAL; `t3 - t0`
is the reported end-to-end latency over ≥ 1000 drags at 60 Hz on the macOS reference
hardware at a 128-frame buffer (mic loopback explicitly not required).

Verify with: `pnpm cargo:test -- -p daw-engine pitch_edit_latency`

### AC-013 — NoteSegment carries gain and fine-pitch fields with the specified ranges

Each `NoteSegment` must carry a `gain` linear amplitude factor in the range `0.0`–`4.0`
(corresponding to roughly -∞…+12 dB) and a `fine_pitch_cents` offset that is independent of
the coarse semitone-quantized `target_pitch_hz`, so a note can be nudged ±50 cents without
changing its nominal semitone.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_edit`

### AC-014 — Reuse the surveyed analysis, store, and command anchors

The implementation must reuse the existing pattern anchors rather than reinvent them:
`src/modules/AudioAnalysis/useCases/pitchDetection.ts` (McLeod Pitch Method, departing to
pYIN/CREPE for monophonic precision), `src/helpers/Store/` for state, and
`src/modules/Command/useCases/pushUndoEntry.ts` for the undo/redo Command pattern.

Verify with: `pnpm deps:validate`

### AC-015 — The pitch editor subscribes only to the active clip's data

The pitch editor must read MIDI/pitch state through `useStoreSelector` calls that subscribe
only to the active clip's notes, the active clip's CC, and the selected track — each with a
shallow-equal `equalityFn` and a stable empty-array sentinel for the empty case — so that
editing a note on a different clip does not re-render the editor.

Verify with: `pnpm test:run -- PitchEditor`

## Open questions

- [ ] (non-blocking) Bundle the CREPE ONNX model with the installer, or download on demand?
- [ ] (non-blocking) Exact crossfade length (2–4 ms) for the live-to-frozen swap.
- [ ] (non-blocking) Expose gain as a symmetric dB parameter rather than a linear factor?
- [ ] (non-blocking) Do Windows (WASAPI) and Linux (ALSA/PipeWire) need their own latency targets, or is macOS the launch reference?
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md §6.3 "ARA-Style Editing & Clip-Native Deep Correction") Clip-native deep correction has no native clip editor and no ARA support today. Two architectural directions remain open: (a) host ARA 2 interfaces via the `clack-host` / `vst3_wrapper` plugin path, or (b) build a custom first-party React/Rust pitch editor on the `Knead` module (this spec's Knead/PSOLA path is direction (b), and the project Non-goals already rule out hosting third-party ARA 2 pitch plugins). The intake also asks for background offline-commit bouncing of corrected regions — for this feature that is the Knead freeze path (see AC-008, which renders edits to a new file on a background thread and swaps at the boundary). The open part is whether clip-native deep correction beyond monophonic Knead (e.g. an ARA 2 host route for third-party correction plugins) is ever pursued, which would reverse a stated Non-goal and is out of this feature's scope.
- [ ] (non-blocking) (restored detail) If the deferred ARA 2 host route (direction (a) above) is ever pursued, CLAP is the strongly-recommended companion API over VST3: ARA attaches to VST3 via COM-style vtable structs (`IPlugInEntryPoint`, available through the `vst3-sys` crate) whereas CLAP attaches via pure C extension structs (the `clap-sys` crate), which is far simpler for a Rust host to populate correctly. This only matters if a stated Non-goal is reversed.
- [ ] (non-blocking) (restored detail) PSOLA synthesis mechanics from the research, for the implementer when AC-005's live path is built: extract windowed grains sized at 2× the local pitch period and Hann-windowed, centered at each detected pitch mark, then reposition the marks at the target pitch period (the delta-map ratio) and overlap-add. Captured here rather than as a binding AC to keep the requirement from prescribing the algorithm.

## Affected areas

- `src/modules/Knead/stores/kneadStore.ts`
- `src/modules/Knead/models/KneadBlob.ts`
- `src/modules/Knead/presentations/views/PitchEditor.tsx`
- `crates/daw-dsp/src/knead/pitch_edit.rs`
- `src-tauri` commands `analyze_pitch` and `commit_pitch_edit`

## Dropped from sources

- ARA 2 host support — deferred to a later phase; it adds a hard dependency on commercial plugins for a core feature (see `research.md`).
- CREPE high-accuracy analysis tier — optional; pYIN is the default analyzer and CREPE waits on `ort` scheduling.
- Rubber Band Library synthesis — GPL v2 licensing; custom PSOLA carries no encumbrance.
