---
type: spec
id: SPEC-midi-engine-primitives
title: MIDI engine primitives — probability, MPE allocator, MIDI clock
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
  - intake/audit-deferred-fixes.md
---

# MIDI engine primitives — probability, MPE allocator, MIDI clock

## Intent

Add real-time-safe MIDI engine primitives the scheduler currently lacks: per-note
probability with deterministic seeding, an RT-safe MPE channel allocator, and a
sample-accurate MIDI clock output generator driven by the audio callback.

## Non-goals

- The pre-instrument MIDI FX chain (arpeggiator, velocity scaler, groove quantizer) —
  that is a deferred gap against the existing `yeast` MIDI-FX feature.
- AI MIDI generation (see existing `midi-generation`).
- External clock input / Ableton Link (see `ableton-link-sync`).

## Requirements

### AC-001 — Per-note probability with deterministic seeding

Sequencer events must support a `probability` (0.0–1.0); the RT scheduler skips notes
whose roll exceeds it, and the same seed reproduces bit-identical output.

Verify with: `pnpm cargo:test -- -p daw-engine note_probability_deterministic`

### AC-002 — Probability distribution is correct

Notes at probability 0.5 must fire ~50% over many seeds (binomial variance within ±3σ).

Verify with: `pnpm cargo:test -- -p daw-engine note_probability_distribution`

### AC-003 — RT-safe MPE channel allocator

An MPE allocator must assign per-note channels 2–16 with an LRU policy, support the
lower-zone convention, and allocate/lock nothing on the audio thread; channel reuse
stalls ≤1 across 10,000 events in the stress fixture.

Verify with: `pnpm cargo:test -- -p daw-engine mpe_allocator_rt_safe`

### AC-004 — Sample-accurate MIDI clock output

A MIDI clock generator driven by the audio callback must emit `0xF8` at 24 PPQN plus
start/stop/continue, with tick jitter ≤0.5 ms stddev over 60 s at 120 BPM.

Verify with: `pnpm cargo:test -- -p daw-engine midi_clock_jitter`

## Open questions

- [ ] (non-blocking) Where the RNG seed is persisted so probability is reproducible across
  reload. Default: stored in the arrangement.
- [ ] (deferred-gap from intake/audit-deferred-fixes.md, "Group G — Recording and
  sequencer") This group was tracked as covered here, but its content is not present in
  the ACs above; recorded now as an open gap. **G2 (sequencer sample-accurate `fire()`,
  I-21):** the step sequencer is still `setTimeout`-based — `sequencerPlayback.ts`'s own
  docstring reads "Uses setTimeout with AudioContext clock correction to avoid setInterval
  drift" and `scheduleSequencerFire.ts` fires via `setTimeout(...)`; it does not compute a
  `sampleFrame` and pass it through `triggerToasterPad`, so pad triggers are not aligned to
  the AudioContext sample grid. **G1 (stereo recording, I-29):** the `Track` model
  (`src/modules/Arrangement/models/Track.ts`) has no `inputChannelCount: 1 | 2` field (its
  `channelCount` lives inside `renderSettings`, i.e. freeze/render, not the record input),
  and `startAudioRecording.ts` does not read a per-track input channel count. Both remain
  unbuilt; carry forward or fold into the relevant recording/sequencer feature.

## Affected areas

- `crates/daw-engine/` (scheduler probability, MPE allocator, MIDI clock)
- `src-tauri/` MIDI output routing via `midir`

## Dropped from sources

- The MIDI FX chain modules — recorded as a deferred gap against `yeast`.
