# Knead — Real-Time Polyphonic Pitch Correction Engine

## Reference research

- `.agents/research/factory/special-effects.md` §2 — Knead gap analysis. Identifies the delta between the shipped monophonic MVP (YIN + PSOLA + basic UI) and the real-time, polyphonic, formant-aware engine this spec targets.
- `.agents/research/factory/active/clip-pitch-editing.md` — underlying research for the monophonic clip-pitch editor (referenced only to make clear what this spec does *not* touch).

All DSP derivations (pYIN transition costs, LPC / cepstral envelope math, STFT window/hop recommendations, phase-vocoder phase-locking rules, transient-detection thresholds, neural multipitch prior architectures, Basic Pitch / `ort` integration) live in the research file. This spec references them by topic and does not re-embed the math.

---

## Context

Sourdaw currently ships **two distinct pitch systems**. This spec is exclusively about the second.

1. **Clip pitch editor** (`.agents/specs/factory/active/clip-pitch-editing.md`). Offline analysis + render on an *audio clip* on the timeline. pYIN analysis runs once, produces `NoteSegment` blobs overlaid on the waveform, and TD-PSOLA applies non-destructive edits at ±700 cents. **Monophonic only.** **Clip-scoped.** **Out of scope here.**
2. **Knead real-time engine** (this spec). A *track insert* that analyzes and corrects pitch **while audio flows through it**, per audio block, with sub-20 ms latency. **Monophonic MVP already shipped** (`crates/daw-dsp/src/knead/{yin,psola,voicing,engine,utils}.rs`, `src/modules/Knead/`). **Polyphonic, formant-aware, and production-workflow features are missing.** Those are the gaps this spec closes.

The existing `kneadStore` (`src/modules/Knead/stores/kneadStore.ts`) holds per-clip UI state (blobs, retune speed, tolerance, humanize, formant preserve toggle). Its shape is public contract and is preserved — persistence integration consists of wiring new fields through the same store, not replacing it.

**How Knead differs from the clip-pitch editor:**

| Dimension | Clip-pitch editor | Knead (this spec) |
| --- | --- | --- |
| Processing model | Offline analysis → non-destructive blob edits → optional freeze/render | Per-block streaming analysis + synthesis on a live track |
| Latency | Not latency-bound (preview via triple buffer, but analysis is one-shot) | Hard-bounded ≤ 20 ms |
| Polyphony | Monophonic only | Polyphonic in scope (STFT / partial tracking) |
| Scope | One audio clip | A track insert; any live audio source |
| Shifting | TD-PSOLA clamped to ±700 ¢ | PSOLA for small shifts, phase vocoder for large/polyphonic |
| Use case | "Tune this take" | Live pitch correction, harmonizer, pitch-to-MIDI, Revoice |

---

## Goal

Ship a real-time, low-latency, optionally polyphonic pitch-correction engine as a track insert, with formant preservation, transient handling, assignment-level repair, harmonizer mode, pitch-to-MIDI extraction, and Revoice-style cross-voice transfer — all persisting through the existing `kneadStore` surface — without disturbing the monophonic clip-pitch editor.

---

## User-visible behavior

- **Insert Knead on a track.** Open the Knead panel on any audio track and hear pitch correction engage with a target latency of ≤ 20 ms end-to-end.
- **Choose a mode.** Modes: `Monophonic`, `Polyphonic (Lab)`, `Harmonizer`, `Pitch-to-MIDI`, `Revoice`. Mode is a project-persisted per-insert setting.
- **Watch detection in real time.** As audio flows, detected pitches appear as scrolling blobs in a history panel (analogous to Melodyne's main view), with confidence shown as fill opacity.
- **Correct with character.** Formant preservation toggle keeps vocal character intact; a separate formant-shift slider (±12 semitones) lets the user decouple spectral envelope from pitch.
- **Polyphonic mode.** Detects up to N simultaneous pitches (N = 6 for v1); each detected pitch renders its own blob track in the history panel.
- **Manual repair.** Right-click any detected note blob to lock it to a user-set pitch; the engine honors the lock from that moment forward. Locks persist in project state.
- **Harmonizer.** Up to 4 additional voices at scale-aware intervals (3rd/5th/octave/user-defined), with per-voice spread, formant variance, and microtiming drift.
- **Pitch-to-MIDI.** Enable pitch-to-MIDI on the insert to emit detected pitches as MIDI events on a sibling track's MIDI input.
- **Revoice.** With a guide track selected, Knead transfers the guide track's pitch and/or formant envelope onto the current signal, at a user-set transfer strength [0, 1].
- **Bypass at zero shift is (near-)transparent.** With correction strength = 0 and shift = 0, Knead is transparent to within 0.5 dB across the audible band; percussive content is bit-identical where the transient bypass fires.

---

## Scope

### In scope

- Rust `daw-dsp` additions: `pyin.rs`, `formant.rs` (LPC + cepstral envelope), `stft.rs`, `partials.rs` (peak + partial tracking), `phase_vocoder.rs`, `transient.rs`.
- Real-time engine orchestration in `crates/daw-dsp/src/knead/engine.rs` extended to switch between PSOLA (mono, small shifts) and phase vocoder (poly, large shifts).
- Assignment / repair data model: per-insert list of user-pinned notes with time/freq bounds.
- Harmonizer DSP: N-voice polyphonic synthesis sharing analysis with the main path.
- Pitch-to-MIDI extractor (monophonic from detected blobs; polyphonic from neural posteriorgram priors if R-N is in).
- Revoice-style transfer engine (pitch track + spectral envelope from guide onto subject).
- Persistence: extend `KneadClipState` / introduce `KneadTrackState` alongside it, persisted through existing `kneadStore` plumbing and Automerge sync.
- UI surfaces for mode switching, assignment repair, harmonizer voice config, pitch-to-MIDI routing, Revoice guide selection.

### Non-goals (explicitly out of scope)

- **Replacing or modifying the monophonic clip-pitch editor** (`clip-pitch-editing.md`). The two systems coexist. Knead does not attempt to edit the clip on the timeline non-destructively — it processes audio flowing through a track.
- **Offline render mode for Knead.** v1 is real-time only. An offline bounce relies on the host's offline render, not a Knead-specific freeze.
- **User-authored neural models.** If we ship a neural multipitch model, it ships baked; users cannot swap it.
- **Re-implementing the existing YIN or PSOLA kernels.** pYIN is additive; it does not delete `yin.rs`. Phase vocoder is additive; it does not delete `psola.rs`.
- **Cross-track comping UI** (multi-take vocal comping with Knead blobs). Deferred to a separate "vocal suite" spec referenced in the research §2.4.
- **De-esser, vocal strip, and vocal FX preset chain** from research §2.4. Knead is the pitch engine; the larger vocal suite is a separate workstream.
- **VST3/CLAP/AU packaging.** Internal insert only, same as other Sourdaw first-party processors.
- **Supporting ARA 2 host integration.**
- **Pitch-to-MIDI output into a *new* track** (auto-track creation). v1 routes MIDI to a user-selected existing MIDI track.
- **Harmonizer voices beyond 4** (research cap of 4 is honored).

---

## Requirements

Each requirement has at least one verifiable acceptance criterion.

### R1. Real-time online pYIN

The engine implements pYIN (probabilistic YIN) with Viterbi sequence decoding, running per audio block with total added latency ≤ 20 ms at 48 kHz / 128-frame blocks. Output is a stream of `(frame, f0_hz, voicing_probability, candidate_probabilities)` records.

**Acceptance criteria:**

- For the fixture `single-voice-sine-sweep.wav` (C3 → C5 glide, clean, no noise), detected `f0` is within **±5 cents** of the ground-truth analytic frequency at ≥ 99% of voiced frames.
- For the fixture `single-voice-vocal-phrase.wav` (labeled ground-truth pitch track at 10 ms hops), detected `f0` is within **±10 cents** at ≥ 95% of voiced frames, and voiced/unvoiced classification agrees with the label at ≥ 95% of frames.
- Added latency measured from audio input to pitch-track availability is ≤ 20 ms at 48 kHz with 128-frame blocks (test harness: tag input with ramp, read back when `pyin::process_block` publishes the frame, assert Δt ≤ 20 ms).
- pYIN runs **in addition to** the existing `yin.rs` path — the monophonic MVP's behavior must not regress. A regression test replays the MVP fixture through the old path and asserts byte-identical output.

### R2. LPC / cepstral formant estimation and preservation

The engine estimates the spectral envelope in real time and exposes three formant modes on the insert: `Preserve` (fold pitch shift under a fixed envelope), `Follow` (let the envelope move with pitch), `Shift` (apply a user-set envelope shift in semitones).

**Acceptance criteria:**

- For the fixture `sustained-vowel-a.wav` shifted up 500 cents in `Preserve` mode, the first three formant peaks (F1, F2, F3) measured at the output are within **±30 Hz** of the input's F1/F2/F3 (measured by LPC root analysis of both).
- For the same fixture in `Follow` mode, output formants shift by `±2^(cents/1200)` within **±30 Hz** of the expected frequency.
- With formant shift = 0 cents and pitch shift = 0 cents, output RMS within any one-octave band from 100 Hz to 8 kHz is within **±0.5 dB** of the input (verified by band-split measurement on a pink-noise fixture).
- LPC order defaults to the research recommendation (12 at 44.1/48 kHz, 16 at ≥ 88.2 kHz) and is exposed as a debug parameter; default behavior does not require the user to set it.

### R3. Polyphonic STFT / partial tracking

The engine provides a polyphonic mode using STFT + peak picking + partial tracking + harmonic grouping that can detect up to 6 simultaneous pitches with per-pitch `f0` and amplitude.

**Acceptance criteria:**

- For the fixture `three-note-chord-a-c-e.wav` (sustained major triad, clean), the engine reports three distinct pitches whose `f0` values are within **±10 cents** of the ground truth for ≥ 95% of analysis frames after onset settling (first 50 ms excluded).
- For the fixture `six-note-cluster.wav`, the engine reports ≥ 5 of 6 ground-truth pitches within ±15 cents for the majority of the sustain region.
- Added latency in polyphonic mode ≤ 40 ms (larger than mono because of the STFT window; 4096-sample window at 48 kHz with 1024 hop).
- Switching from monophonic to polyphonic and back on the live insert does not produce audio discontinuity above −60 dBFS on a held sine-wave test signal.

### R4. Phase vocoder pathway

A phase vocoder with phase-locking around spectral peaks provides the synthesis pathway for polyphonic shifts and for any shift greater than 700 cents in either direction. The engine routes to PSOLA for monophonic shifts within ±700 cents (consistent with the clip-pitch editor) and to the phase vocoder otherwise.

**Acceptance criteria:**

- Shifting `single-voice-vocal-phrase.wav` by **+1200 cents** through the phase vocoder produces an output whose detected pitch (re-measured with pYIN) is within ±10 cents of the target frequency across ≥ 95% of voiced frames.
- The output of the +1200 cents shift has a measured phasiness metric (research §2.2 spectral-peak phase-coherence score) no worse than the research baseline value listed for peak-locked phase vocoders.
- Switching between the PSOLA pathway and the phase vocoder pathway at runtime (e.g., shift ramps from 600 → 800 cents) uses an equal-power crossover within 10 ms, with no sample discontinuity greater than 1 LSB at 24-bit during the crossover.
- Phase vocoder runs on polyphonic signals without clipping or denormals (assertion: output peak ≤ 0 dBFS and zero denormals reported by `is_subnormal`).

### R5. Transient preservation

A transient detector based on spectral flux + energy slope marks transient frames; during a transient, the PSOLA / phase-vocoder grain synthesis is bypassed and the input is passed through directly, with a crossfade of ≤ 5 ms on either side.

**Acceptance criteria:**

- A percussive fixture (`kick-drum-impulse.wav`) fed through Knead with shift = 0 cents and `Preserve` formants produces output whose peak sample amplitude is within **±0.5 dB** of the input over a 10 ms window centered on the transient, and the transient onset time (10% of peak) matches the input within **±1 sample**.
- With shift ≠ 0, transients are still preserved in *timing*: the 10%-of-peak onset time matches the input within **±3 samples** (timing of the transient passthrough does not drift with shift amount).
- Transient detection thresholds are exposed as debug parameters; default behavior matches the research §2.2 recommendation.

### R6. Assignment / repair Lab tools

The engine accepts a list of user assignments (per-insert, per-time-range) that lock a detected note to a user-specified pitch. An assignment scopes to a frequency band (default `detected_pitch ± 1 semitone`) and a time range. Within an assignment's scope, the engine overrides its own detection with the user's lock.

**Acceptance criteria:**

- Setting an assignment `{ t_start, t_end, target_hz, band_hz }` and playing audio that contained an originally-detected pitch within `band_hz` of the new target produces output whose re-measured pitch is within **±5 cents** of `target_hz` over the full `[t_start, t_end]` window.
- Outside the assignment's time/frequency range, engine behavior is unchanged (verified by comparing output with assignment-inactive reference on a matched fixture).
- Assignments persist across save/reload (stored under `kneadStore` per-track state).
- The UI allows creating, editing, and deleting assignments on the history-panel blob view; each assignment is visually distinct from auto-detected blobs.

### R7. Harmonizer mode

Up to 4 additional voices are generated at user-configured intervals (semitones, scale-aware where the Global Harmonic Awareness surface is available). Per-voice parameters: interval (semitones), delay (ms), detune (cents), formant variance (cents), level (dB), pan.

**Acceptance criteria:**

- With a single harmonizer voice at +7 semitones on `sustained-vowel-a.wav`, the output contains two distinct pitch tracks: the original `f0` and `f0 * 2^(7/12)`, each measurable to within ±10 cents of the expected frequency across ≥ 95% of voiced frames.
- With four voices configured, the total added latency does not exceed the base polyphonic-mode latency budget in R3.
- Harmonizer voices are gain-staged so that summing them with the dry signal at default levels produces a peak output within ±1 dB of the dry signal's peak (no gain blowouts).
- When a Global Harmonic Awareness spec is present and active, scale-aware mode quantizes harmonizer interval choices to the active key / scale.

### R8. Pitch-to-MIDI extraction

The engine emits detected pitches as MIDI note events to a user-selected MIDI track. Monophonic mode emits from the mono pYIN blob stream; polyphonic mode emits from the partial-tracking output (and from neural priors if R-N is in scope). Note-on is emitted when a stable pitch is confirmed (confidence ≥ threshold for ≥ 50 ms); note-off when voicing drops or pitch jumps ≥ 60 cents for ≥ 30 ms.

**Acceptance criteria:**

- For the fixture `sung-melody-labeled.mid`-paired audio, emitted MIDI notes match the label within **±1 semitone** on ≥ 95% of notes and within **±30 ms** of ground-truth onset on ≥ 90% of notes.
- MIDI emission adds ≤ 60 ms of detection-to-emission latency in monophonic mode (longer than audio latency because of the confidence stability window).
- Polyphonic mode emits overlapping notes correctly for a major-triad fixture (≥ 2 of 3 notes present concurrently at any steady-state frame).
- Target MIDI track is user-selectable from existing arrangement tracks; auto-track creation is out of scope (Non-goal).

### R9. Revoice mode

Given a user-selected guide track (any audio track in the project), Knead extracts the guide's pitch track (pYIN) and spectral envelope (LPC) and applies them to the subject signal at a user-set `transfer_strength ∈ [0, 1]`. Independent sliders for pitch transfer and formant transfer.

**Acceptance criteria:**

- With `transfer_strength_pitch = 1.0` and `transfer_strength_formant = 0.0` on a fixture pair (subject: spoken phrase, guide: sung phrase of the same words), the output pitch track matches the guide's pitch within **±20 cents** over ≥ 90% of voiced frames and the formants remain close to the subject (F1/F2/F3 within ±50 Hz of subject's).
- With both sliders at 1.0, output formants also match the guide within ±50 Hz.
- With both sliders at 0.0, output is bit-identical to subject pass-through (equivalent to bypass).
- Latency with Revoice engaged ≤ 80 ms (larger budget for guide analysis pipeline).

### R10. Persistence and store integration

All Knead insert state persists through the existing `kneadStore` plumbing (which already integrates with Automerge via `updateClip`). A new `KneadTrackState` slice is added alongside `KneadClipState` (clip state is retained unchanged for the clip-pitch editor's use).

**Acceptance criteria:**

- `KneadTrackState` round-trips through save → reload with byte-identical fields for: mode, formant settings, polyphonic on/off, assignment list, harmonizer voices, pitch-to-MIDI routing, Revoice guide + strengths.
- The existing `KneadClipState` shape is unchanged; a snapshot test asserts this.
- `pnpm deps:validate` passes with zero violations; the Knead module exposes only the root barrel as its public surface.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- Audio thread must never allocate, lock a mutex, or block. Parameter updates flow via atomics or `triple_buffer`; analysis state swaps use lock-free double-buffering on the non-RT side.
- No GPL-licensed libraries. Rubber Band Library is explicitly out.
- pYIN and phase vocoder implementations are clean-room, citing research file equations; no code copied from GPL reference implementations.
- `daw-dsp` remains I/O-free; all file-based analysis (Revoice guide loading) happens in the I/O layer and publishes into `daw-dsp` via the existing RT-safe handoff.
- Per `AGENTS.md` TypeScript-soundness: no `any` at boundaries without immediate narrowing; Zod or typed narrowing at Tauri IPC edges.
- `kneadStore` is the sole cross-module surface; no deep imports into `#/modules/Knead/useCases/*` from other modules.

---

## Design decisions

### Decision: pYIN over CREPE for the real-time online path

**Chosen:** pYIN for the live engine; the existing CREPE path (via `ort`) remains available as the optional high-quality analyzer in the clip-pitch editor only.
**Justification:** CREPE's inference cost is incompatible with a 20 ms end-to-end latency budget on CPU. pYIN is deterministic, runs per block, has sub-5 ms added latency at 48 kHz, and produces a probability posterior the Viterbi decoder needs.
**Considered and rejected:** CREPE in the RT path (latency budget blown even on GPU). Continuing with plain YIN (does not produce the multi-candidate posterior required for pYIN's Viterbi decoding, loses accuracy on noisy vocals).

### Decision: phase vocoder for polyphonic and extreme shifts

**Chosen:** PSOLA for monophonic shifts within ±700 cents; peak-locked phase vocoder for polyphonic mode and for any shift beyond ±700 cents.
**Justification:** TD-PSOLA degrades audibly beyond ±700 cents (consistent with the clip-pitch editor's cap). It also cannot synthesize multiple independent pitches from a polyphonic analysis. Phase vocoders are the standard solution for polyphonic time/pitch-scale modification; peak-locking (Laroche/Dolson) reduces the classic phase-vocoder "phasiness".
**Considered and rejected:** WSOLA (good for time-stretching, weaker for pitch shifting of polyphony). Sinusoidal-plus-residual (higher quality but significantly more state and complexity than justified for v1). Rubber Band (GPL).

### Decision: transient bypass instead of transient-aware phase propagation

**Chosen:** Detect transients, bypass synthesis across them with a short crossfade (≤ 5 ms).
**Justification:** Phase-vocoder phase propagation across transients smears them perceptually; direct passthrough guarantees the transient energy and timing are preserved.
**Considered and rejected:** Phase-reset-at-transient (still introduces artifacts; bypass is simpler and passes the bit-identical test at shift = 0). Per-transient re-estimation of phase coherence (complex; marginal perceptual win).

### Decision: assignment model at the frequency-band + time-range level

**Chosen:** Assignments bind a user-chosen `(target_hz, band_hz)` to a `(t_start, t_end)` window; within that window, detections inside the band are snapped to the target.
**Justification:** Mirrors Melodyne's assignment-mode mental model. Decouples the UX (drag a blob, set its pitch) from the DSP (override a frequency band in a time range). Plays well with polyphonic mode — multiple concurrent assignments with non-overlapping bands is well-defined.
**Considered and rejected:** Per-blob override that rebuilds the pitch track from scratch after the lock (higher complexity, less predictable under live input).

### Decision: pitch-to-MIDI routes to existing tracks only

**Chosen:** User selects an existing MIDI track as the pitch-to-MIDI destination.
**Justification:** Auto-track creation is a product decision beyond the DSP scope and involves arrangement UX that this spec does not own.
**Considered and rejected:** Auto-creating a MIDI sibling track — deferred.

### Decision: `KneadTrackState` alongside `KneadClipState`

**Chosen:** Add a new per-track slice to `kneadStore`; keep `KneadClipState` unchanged.
**Justification:** The two systems have different lifetimes (clip-lifetime vs track-lifetime), different field sets (clip has `clipId`, track has `trackId`), and different persistence keys. Collapsing them into a single shape would require optionality that contradicts `AGENTS.md`'s rule against optional fields encoding mutually exclusive states.
**Considered and rejected:** Unified `KneadInsertState` with discriminated `kind: 'clip' | 'track'`. Rejected as premature unification; the two systems evolve independently.

---

## Acceptance criteria

- [ ] R1 pYIN accuracy, voicing, latency tests pass on the named fixtures.
- [ ] R1 does not regress the existing YIN MVP (byte-identical replay).
- [ ] R2 formant `Preserve` / `Follow` / `Shift` produce formant measurements within ±30 Hz of expected for the sustained-vowel fixture.
- [ ] R2 transparency at shift = 0, formant shift = 0 is within ±0.5 dB across 100 Hz → 8 kHz band splits.
- [ ] R3 polyphonic detection on three-note and six-note chord fixtures meets the stated tolerance.
- [ ] R3 mode-switch (mono ↔ poly) produces no discontinuity above −60 dBFS.
- [ ] R4 +1200 cent shift via phase vocoder produces output pitch within ±10 cents of target.
- [ ] R4 PSOLA ↔ phase vocoder crossover at the 700-cent boundary produces no > 1 LSB discontinuity.
- [ ] R5 percussive hit at shift = 0 produces output within ±0.5 dB of input over the transient window and onset timing within ±1 sample.
- [ ] R5 transient timing under non-zero shift stays within ±3 samples of input.
- [ ] R6 assignment locks override detection within the band+range and pass the ±5 cent match test.
- [ ] R6 assignments persist across save/reload.
- [ ] R7 single-voice harmonizer produces two pitch tracks at expected intervals to within ±10 cents.
- [ ] R7 four-voice harmonizer respects the polyphonic-mode latency budget.
- [ ] R8 pitch-to-MIDI matches labeled melodies within ±1 semitone on ≥ 95% of notes and ±30 ms onset on ≥ 90%.
- [ ] R8 monophonic MIDI emission adds ≤ 60 ms detection-to-emission latency.
- [ ] R9 Revoice transfer sliders produce the expected pitch / formant matching against guide, bit-identical bypass at 0/0.
- [ ] R10 `KneadTrackState` round-trips save → reload byte-identically; `KneadClipState` shape unchanged.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] Static analysis confirms no `Mutex::lock`, `RwLock::read/write`, heap-allocation macros, or `.await` in the Knead audio-thread path in `daw-dsp` and `daw-engine`.
- [ ] No `any`, no silencing casts, no `@ts-expect-error` / `@ts-ignore` without justification in added TypeScript code (per `AGENTS.md`).

---

## Implementation notes

- **Pattern survey findings:**
    - `crates/daw-dsp/src/knead/yin.rs` is the existing monophonic YIN kernel. pYIN lives next to it as `pyin.rs` and reuses the cumulative mean normalized difference function (CMND) from `yin.rs`; the Viterbi decoding and probability posterior are new.
    - `crates/daw-dsp/src/knead/psola.rs` stays for monophonic small-shift synthesis. Phase vocoder lives in a new `phase_vocoder.rs` sibling and a synth-dispatch in `engine.rs` routes based on mode + shift amount.
    - `src/modules/Knead/stores/kneadStore.ts` already integrates with `updateClip` for Automerge persistence; `KneadTrackState` wires through the same pattern but against a `updateTrack` use case if one exists (survey: `src/modules/Arrangement/useCases/` for the track equivalent of `updateClip`).
    - Formant LPC / cepstral code lives in `formant.rs`; reuse `rustfft` already in `daw-dsp` for cepstrum computation.
    - Transient detection reuses the spectral-flux helper pattern; check `crates/daw-dsp/src/` for existing spectral utilities before adding a new one.
- **RT-safety scaffolding:** the same `triple_buffer` pattern used by the clip-pitch editor is the recommended carrier for Knead's per-insert parameter updates. Audio-thread reads are generation-counter-gated; non-RT writes never block.
- **Fixtures:** place under `crates/daw-dsp/tests/fixtures/knead/`. Source ground-truth pitch tracks only from open datasets (as constrained by the piano-plugin spec's IP rules; the same constraints apply).
- **UI:** the existing `KneadEditor.tsx` shell is extended with mode tabs. Avoid duplicating controls across modes — shared controls (formant, transparency) live in a common header; mode-specific controls populate the mode pane.
- **Neural multipitch (optional, see Open questions):** if adopted, the model ships via `ort` as in the clip-pitch editor, and polyphonic mode's acceptance tolerance can be tightened. If not adopted in v1, polyphonic detection relies on STFT + partial tracking alone and the acceptance tolerances stand as written.

---

## Test plan

- **Automated:**
    - Rust unit tests in `daw-dsp` for pYIN (candidates, Viterbi decoding), LPC/cepstral envelope math, STFT peak picking, partial tracking birth/death, phase-locked phase vocoder, transient detector thresholds.
    - Integration tests in `daw-dsp` driving `engine.rs` end-to-end on each named fixture with expected tolerances.
    - TypeScript unit tests for `KneadTrackState` store wiring (`kneadStore` + persistence round-trip).
    - Component tests for mode tabs, assignment editing, harmonizer voice panel, pitch-to-MIDI routing, Revoice guide selection.
    - Latency harness that measures input-to-output delay under each mode and asserts against R1/R3/R7/R9 budgets.
    - `pnpm deps:validate` in CI after the change.
    - Static analysis check: grep/lint that the Knead audio path in `daw-dsp` and `daw-engine` contains zero banned primitives (see last acceptance bullet above).
- **Manual:**
    - Load a live vocal, engage monophonic mode at shift = 0, confirm transparency by A/B with bypass.
    - Switch to polyphonic mode on a guitar-chord recording, confirm blobs appear for multiple pitches and the sound holds together.
    - Lock a detected note via assignment, confirm the lock holds on re-play.
    - Enable harmonizer with +3 / +5 / +7 voices, confirm a 3-note chord is produced from a single note input.
    - Enable pitch-to-MIDI, sing a melody, confirm MIDI notes land on the target track matching the sung pitches.
    - [ ] Manual: Enable Revoice with a guide track, confirm timing/pitch transfer with the sliders.

    ---

    ## Implementation Status

    - **What is implemented:** The monophonic MVP is implemented in `crates/daw-dsp/src/knead/`. This includes YIN pitch detection (`yin.rs`), PSOLA synthesis (`psola.rs`), voicing detection, and the basic engine orchestration. The `kneadStore` also exists in the frontend.
    - **What is not implemented:** Moved to `.agents/specs/missing/spec-of-the-gaps.md`.
    - **What is done well:** The monophonic MVP is correctly isolated in the DSP crate and follows real-time safety principles.
    - **What needs refactoring:** Moved to `.agents/specs/missing/spec-of-the-gaps.md`.


---

## Open questions

- [ ] **[CRITICAL]** CPU budget for polyphonic mode: on the reference hardware (M1 Pro at 48 kHz, 128-sample block), what is the maximum number of Knead polyphonic inserts that can run concurrently? The answer gates whether the default polyphonic STFT window/hop (4096/1024) is viable or must be scaled down, and whether the harmonizer + polyphonic modes are compatible on a single insert.
- [ ] **[CRITICAL]** Does Knead ship with a guaranteed `N_polyphonic_max = 6` at launch, or is the target 4 with 6 as an opt-in Lab feature? This directly affects R3 acceptance tolerances and CPU budgeting.
- [ ] **[MAJOR]** Neural multipitch (Basic Pitch / `ort`) — is it required for v1 polyphonic accuracy, or optional? Current spec treats it as optional. If required, R3 polyphonic tolerances should tighten and the installer size grows by the model weights. Decision influences both UX and install footprint.
- [ ] **[MAJOR]** Phase-vocoder window/hop selection for polyphonic use: 4096/1024 is the research default; confirm it meets R3's 40 ms latency budget on the reference hardware or fall back to 2048/512 with documented quality tradeoffs.
- [ ] **[MAJOR]** Assignment model for polyphonic — if two simultaneously-detected pitches fall within overlapping bands, what is the precedence? Current spec requires non-overlapping bands; a runtime error is raised otherwise. Confirm this, or define a "snap the closest detection" rule.
- [ ] **[MINOR]** Revoice transfer with different sample rates between subject and guide — resample guide on load, or reject the pairing? Current plan: resample to subject SR at guide-load time.
- [ ] **[MINOR]** Pitch-to-MIDI monophonic mode: note-on confidence threshold and hold-time defaults (currently 50 ms hold, 30 ms drop). Confirm against a production dataset.
- [ ] **[MINOR]** Harmonizer `detune` and `delay` ranges. Research suggests ±30 cents detune and 0–40 ms delay for "natural doubling"; confirm.
- [ ] **[MINOR]** Should `KneadTrackState` be a sibling slice on the existing `kneadStore` or a new `kneadTrackStore`? Current design picks the sibling slice for discoverability; revisit if the shape grows.
- [ ] **[MINOR]** When the user deletes the MIDI track currently selected as pitch-to-MIDI target, fall back to "disabled" or surface a warning and hold the setting until a replacement is chosen?

---

## Tradeoffs and risks

- **Latency vs accuracy.** pYIN's Viterbi decoding introduces a delay equal to the decoding window (≈ 15 ms at the default settings). Tightening the decoder for lower latency reduces octave-error robustness. The chosen 20 ms budget is a deliberate point in that tradeoff.
- **Polyphonic accuracy vs CPU.** STFT + partial tracking is a second-tier polyphonic analyzer; it cannot match neural multipitch accuracy on dense polyphony. The spec offers neural multipitch as a follow-on (open question). Shipping without it is acceptable for v1 if R3 tolerances hold.
- **Phase-vocoder artifacts on dense polyphony.** Peak-locking reduces phasiness but does not eliminate it. Dense chords with close-frequency partials are a known weak point for any phase vocoder; we accept this and surface it in the UI as a "Lab" marker.
- **Transient bypass can leak pitched content.** Any transient is, in part, pitched; bypassing it means that part is unshifted. This is a deliberate audio-quality tradeoff over smearing and is consistent with commercial-tool defaults.
- **Assignment model complexity in polyphonic.** Overlapping assignments can be ill-defined; the spec rejects them runtime-side rather than silently resolving. This surfaces configuration errors early.
- **Two pitch systems.** Knead and the clip-pitch editor are distinct code paths with overlapping concepts. Keeping them separate is deliberate (see Context table) but means users must learn which system to use when. We mitigate with UI affordance: a clip's context menu offers "Edit pitch on clip" (routes to clip-pitch editor); the track insert slot offers "Knead" (routes to this engine).
- **IP risk on pYIN and phase vocoder implementations.** Both are published research; the spec requires clean-room implementations citing the research file. No GPL reference code may be ported.
