---
type: spec
id: SPEC-knead
title: Knead — real-time polyphonic pitch-correction engine
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Knead — real-time polyphonic pitch-correction engine

## Intent

Ship Knead as a real-time, low-latency, optionally polyphonic pitch-correction track
insert — with formant preservation, transient handling, assignment repair, a
harmonizer, pitch-to-MIDI, and Revoice — persisting through the existing Knead store,
without disturbing the monophonic clip-pitch editor (`../clip-pitch-editing/spec.md`).
DSP derivations live in `../atmos/research-special-effects.md` §2 and
`../clip-pitch-editing/research.md`.

## Non-goals

- Modifying the clip-pitch editor; the two pitch systems coexist.
- An offline Knead render — v1 is real-time only; offline relies on the host bounce.
- User-swappable neural models, cross-track comping, the wider vocal-FX suite.
- VST3/CLAP/AU packaging, ARA 2 host integration, GPL libraries (Rubber Band is out).
- Pitch-to-MIDI auto-track creation, and harmonizer voices beyond four.

## Requirements

### AC-001 — Real-time pYIN detects monophonic pitch accurately

On a clean C3→C5 sine sweep, detected `f0` must be within ±5 cents at ≥ 99% of voiced
frames; on a labeled vocal phrase, within ±10 cents at ≥ 95%.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_pyin`

### AC-002 — The shipped monophonic MVP does not regress

pYIN must run in addition to the existing YIN path.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_yin`

### AC-003 — Added latency stays within the real-time budget

Monophonic added latency must be ≤ 20 ms at 48 kHz with 128-frame blocks.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_latency`

### AC-004 — Formant preservation keeps vocal character

In `Preserve` mode, a +500-cent shift must keep F1/F2/F3 within ±30 Hz of the input's.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_formant`

### AC-005 — Zero-shift processing is transparent

With shift 0 and formant shift 0, output band RMS must stay within ±0.5 dB of input
from 100 Hz to 8 kHz.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_transparency`

### AC-006 — Polyphonic mode detects multiple pitches

STFT + partial tracking must report up to 6 pitches within ±10 cents on a clean triad
at ≥ 95% of post-onset frames.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_polyphonic`

### AC-007 — The phase vocoder handles large and polyphonic shifts

A +1200-cent shift re-measured with pYIN must land within ±10 cents at ≥ 95% of voiced
frames.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_phase_vocoder`

### AC-008 — Transients pass through preserved

At shift 0, a percussive hit must stay within ±0.5 dB over the transient window with
onset timing within ±1 sample.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_transient`

### AC-009 — Assignment locks override detection

Within an assignment's band and time range, output pitch must snap within ±5 cents of
the user target; outside the range, behavior is unchanged.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_assignment`

### AC-010 — Harmonizer generates configured voices

Up to four voices at configured intervals must each track within ±10 cents of the
expected frequency while staying within the polyphonic latency budget.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_harmonizer`

### AC-011 — Pitch-to-MIDI emits detected notes to a chosen track

Emitted MIDI must match a labeled melody within ±1 semitone on ≥ 95% of notes and
±30 ms onset on ≥ 90%, routed to a user-selected existing MIDI track.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_pitch_to_midi`

### AC-012 — Revoice transfers guide pitch and formant

With pitch transfer 1.0 and formant 0.0, output pitch must match the guide within ±20
cents while formants stay near the subject.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_revoice`

### AC-013 — Track state persists through the Knead store

`KneadTrackState` must round-trip save→reload byte-identically while `KneadClipState`
shape is unchanged.

Verify with: `pnpm test:run -- kneadStore`

### AC-014 — The Knead audio path is real-time safe

The `daw-dsp` / `daw-engine` Knead audio path must contain no mutex/rwlock lock, heap
allocation, or `.await`.

Verify with: `manual` — grep the Knead audio path for `Mutex::lock`, `RwLock`, alloc macros, and `.await`

### AC-015 — Module boundaries hold

Knead must expose only its root barrel and pass dependency validation.

Verify with: `pnpm deps:validate`

### AC-016 — Formant `Follow` mode tracks pitch

The formant stage must expose three modes; in `Follow` a +500-cent shift must move output formants by `2^(cents/1200)` to within ±30 Hz of the expected frequency.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_formant_modes`

### AC-017 — A formant-shift slider decouples spectral envelope from pitch

The insert must expose a formant-shift control spanning ±12 semitones whose movement shifts the spectral envelope by the set amount while leaving detected `f0` unchanged within ±5 cents.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_formant_shift_slider`

### AC-018 — Harmonizer voices carry full per-voice parameters

Each of the up-to-four harmonizer voices must independently honor its configured interval (semitones), delay (ms), detune (cents), formant variance (cents), level (dB), pan, spread, and microtiming drift, with each voice's measured pitch, level, and timing matching its configuration within the stated tolerances.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_harmonizer_voice_params`

### AC-019 — Scale-aware harmonizer quantizes intervals to the active key/scale

When a Global Harmonic Awareness surface is present and active, scale-aware mode must quantize each harmonizer voice's interval choice to the active key/scale.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_harmonizer_scale_aware`

### AC-020 — Polyphonic, pitch-to-MIDI, and Revoice latency budgets hold

Added latency must stay within mode-specific budgets: ≤ 40 ms in polyphonic mode (4096-window / 1024-hop at 48 kHz), ≤ 60 ms detection-to-emission for monophonic pitch-to-MIDI, and ≤ 80 ms with Revoice engaged.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_mode_latency`

### AC-021 — PSOLA↔phase-vocoder crossover is glitch-free at the ±700-cent boundary

Ramping the shift across the ±700-cent PSOLA/phase-vocoder boundary must use an equal-power crossover completing within 10 ms with no sample discontinuity greater than 1 LSB at 24-bit during the crossover.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_crossover`

### AC-022 — Live mono↔poly mode switching stays inaudible

Switching from monophonic to polyphonic and back on a live insert fed a held sine must produce no audio discontinuity above −60 dBFS.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_mode_switch`

### AC-023 — Secondary detection and synthesis tolerances are enforced

The suite must additionally assert: voiced/unvoiced classification agrees with the label at ≥ 95% of frames (R1), the six-note-cluster fixture reports ≥ 5 of 6 pitches within ±15 cents over the sustain (R3), the +1200-cent phase-vocoder output's phasiness metric is no worse than the research baseline with output peak ≤ 0 dBFS and zero denormals (R4), and transient onset timing under non-zero shift stays within ±3 samples of the input (R5).

Verify with: `pnpm cargo:test -- -p daw-dsp knead_secondary_tolerances`

### AC-024 — Replaying the MVP fixture through the old path is byte-identical

Replaying the MVP fixture through the old YIN path must produce byte-identical output.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_yin`

### AC-025 — Both Revoice sliders at 0 is a bit-identical bypass

With both Revoice sliders at 0, output must be a bit-identical bypass of the input.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_revoice`

### AC-026 — Formant `Shift` mode applies a user envelope offset

In `Shift` mode, a user-set envelope offset (semitones) must move F1/F2/F3 by that offset within ±30 Hz while pitch is unchanged.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_formant_modes`

### AC-027 — Harmonizer voices are gain-staged against the dry peak

Summing all configured harmonizer voices with the dry signal at default levels must produce a peak output within ±1 dB of the dry signal's peak (no gain blowouts).

Verify with: `pnpm cargo:test -- -p daw-dsp knead_harmonizer_gain_stage`

### AC-028 — Polyphonic pitch-to-MIDI emits overlapping notes

In polyphonic mode, a major-triad fixture must emit overlapping notes correctly, with ≥ 2 of the 3 notes present concurrently at any steady-state frame.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_pitch_to_midi_poly`

### AC-029 — Revoice with both sliders at 1.0 transfers formants too

With both Revoice sliders (pitch transfer and formant transfer) at 1.0, output formants must match the guide within ±50 Hz.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_revoice`

### AC-030 — Assignments are editable on the history-panel blob view

The UI must allow creating, editing, and deleting assignments on the history-panel blob view, and each assignment must be visually distinct from auto-detected blobs.

Verify with: `pnpm test:run -- KneadEditor`

### AC-031 — LPC order defaults to the research recommendation and is a debug parameter

LPC order must default to the research recommendation (12 at 44.1/48 kHz, 16 at ≥ 88.2 kHz) without requiring the user to set it, and must be exposed as a debug parameter.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_lpc_order_default`

### AC-032 — Transient-detection thresholds default to the research recommendation and are debug parameters

Transient-detection thresholds must be exposed as debug parameters, and default behavior must match the research recommendation.

Verify with: `pnpm cargo:test -- -p daw-dsp knead_transient_thresholds`

## Open questions

- [ ] Polyphonic CPU budget on reference hardware (M1 Pro, 48 kHz, 128-sample block):
  how many polyphonic inserts run concurrently? Gates the default STFT window/hop.
- [ ] Does Knead guarantee `N_polyphonic_max = 6` at launch, or target 4 with 6 as an
  opt-in Lab feature? Affects R3-equivalent tolerances and CPU budgeting.
- [ ] (non-blocking) Neural multipitch (Basic Pitch / `ort`) for polyphonic accuracy —
  required for v1 or optional? Current plan treats it as optional.
- [ ] (non-blocking) Overlapping-assignment precedence in polyphonic mode — reject, or
  snap the closest detection? Current plan requires non-overlapping bands.
- [ ] (non-blocking) (restored detail) Revoice subject/guide sample-rate mismatch —
  resample the guide on load, or reject the pairing? Current plan: resample to the
  subject's sample rate at guide-load time.
- [ ] (non-blocking) (restored detail) Pitch-to-MIDI note-on/off defaults — confirm
  against a production dataset. Current defaults: confidence ≥ threshold for ≥ 50 ms to
  emit note-on; note-off when voicing drops or pitch jumps ≥ 60 cents for ≥ 30 ms.
- [ ] (non-blocking) (restored detail) Harmonizer `detune` and `delay` default ranges —
  research suggests ±30 cents detune and 0–40 ms delay for "natural doubling"; confirm.
- [ ] (non-blocking) (restored detail) Should `KneadTrackState` be a sibling slice on the
  existing `kneadStore`, or a new `kneadTrackStore`? Current design picks the sibling
  slice for discoverability; revisit if the shape grows.
- [ ] (non-blocking) (restored detail) When the user deletes the MIDI track currently
  selected as the pitch-to-MIDI target — fall back to "disabled", or surface a warning
  and hold the setting until a replacement is chosen? Undecided.
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md §5.2 "A Serious
  Vocal Suite") The umbrella gap asks to expand Knead from basic pitch correction into a
  full vocal bundle of three parts: (a) **formant-preserving harmonization** — already
  owned by this spec (AC-004, AC-010, AC-016, AC-017, AC-018, AC-026), no new work;
  (b) **real-time doubler** — a distinct stage from the pitched harmonizer: it produces
  unison/near-unison thickening copies of the lead voice with per-copy micro-detune
  (cents), micro-timing offset (ms), and stereo spread, preserving the lead's formants,
  to emulate multi-take stacking. Whether the doubler is a Knead v1 stage or its own
  insert, how many copies it generates, and its added-latency budget are undecided;
  (c) **dedicated UI for vocal comping and de-essing** — both are explicitly out of this
  spec's scope per "Dropped from sources" (cross-track comping is arrangement UX; the
  de-esser belongs to the separate vocal-FX preset-chain workstream). Non-blocking:
  the doubler is the only genuinely unaddressed sub-part and is forward scope, not a v1
  requirement; comping/de-ess UI stay owned by the separate vocal-suite workstream.

## Affected areas

- `crates/daw-dsp/src/knead/{pyin,formant,stft,partials,phase_vocoder,transient,engine}.rs`
- `src/modules/Knead/**` (`stores/kneadStore.ts`, mode UI, assignment/harmonizer panels)

## Known risks

Present-state findings from the Knead-module audit (`audits/modules/Knead.md`); each
is an observation of current code, not a requirement.

- (Finding #26) Type-shape disagreement at the engine boundary: the producer
  (`syncKneadToEngine.ts:6`) defines `EngineKneadState` as `KneadClipState &
  {startBeat, endBeat}` (all 7 `KneadClipState` fields plus 2, i.e. 9), while the
  consumer worklet (`kneadProcessor.ts:13-24`) declares `KneadClip` as only
  `{startBeat, endBeat, blobs}`. The worklet accepts the wider object via duck typing
  and the engine API erases it to `Record<string, unknown>`
  (`createWebAudioEngine.ts:334`), so a field-set drift between the two surfaces raises
  no type error — e.g. adding `formantShiftCents` to `KneadClipBlob` is not propagated
  back to `Knead/`; the engine just silently ignores fields it does not read.
- (Finding #18) `ingestDspAnalysis`'s gap-bridge finalizes a blob inside the loop while
  `finalizeBlob` also resets `currentPitchPoints`/`gapCounter` — the dual responsibility
  (finalize + reset over closed-over mutables) makes the function impure and the control
  flow hard to reason about (`dspAnalysis.ts:74-82`).
- (Finding #19) `pitchCurveCents` is stored as the per-frame deviation from the blob's
  MEAN MIDI cents — not from the nearest semitone or the original target pitch — so the
  post-MIDI semitone quantization is discarded. A blob bridged across two pitches gets a
  mean sitting between them and a curve that wobbles around nowhere; there is no
  multi-pitch test (`dspAnalysis.ts`).
- (Tradeoff: latency vs accuracy) pYIN's Viterbi decoding adds a delay equal to its
  decoding window (≈ 15 ms at default settings); tightening it for lower latency reduces
  octave-error robustness. The 20 ms budget (AC-003) is a deliberate point in that
  tradeoff.
- (Tradeoff: transient bypass) Bypassing synthesis across a transient (AC-008) leaves the
  pitched part of that transient unshifted — a deliberate audio-quality choice over
  smearing, consistent with commercial-tool defaults.

## Design rationale (decided)

These alternatives were considered and rejected during spec authoring; recorded so the
choices are not re-litigated. pYIN was chosen over CREPE for the real-time online path
(CREPE's inference cost blows the latency budget even on GPU); CREPE remains the optional
high-quality analyzer in the clip-pitch editor only. Rejected synthesis alternatives:
WSOLA (weaker for pitch-shifting polyphony), sinusoidal-plus-residual (higher quality but
far more state than v1 justifies), phase-reset-at-transient (still artifacts; plain bypass
is simpler and passes the shift-0 bit-identical test), and a unified `KneadInsertState`
discriminated union over clip/track (rejected as premature unification — the two systems
have different lifetimes, field sets, and persistence keys, so a union would force
optionality that contradicts the model rules).

## Dropped from sources

- User-swappable neural models — if a neural multipitch model ships, it ships baked.
- Cross-track comping and the de-esser / vocal-FX preset chain — a separate vocal-suite
  workstream; Knead is the pitch engine only.
- Pitch-to-MIDI auto-track creation — routes to an existing MIDI track; auto-creation
  is arrangement UX this spec does not own.
- Rubber Band Library — GPL, incompatible with Sourdaw distribution; the phase vocoder
  and pYIN are clean-room implementations citing the research file.
