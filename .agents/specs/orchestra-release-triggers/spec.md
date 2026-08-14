---
type: spec
id: SPEC-orchestra-release-triggers
title: Orchestra release triggers and note-off behavior
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra release triggers and note-off behavior

## Intent

Make every Orchestra note-off sound real rather than abruptly silent: play the
recorded release ("key-off") sample for the note where one exists, scale its
level by how the note was played, and hold release under the sustain pedal so
notes ring until the pedal lifts.

## Non-goals

- Synthetic release modeling when no release sample exists (noise burst, body
  tail) — owned by `SPEC-orchestra-physical-modeling`.
- The recorded release-trigger sample assets (asset work).
- Legato transitions on the trailing note — owned by
  `SPEC-orchestra-legato-engine`.

## Requirements

### AC-001 — A release sample fires on note-off when available

When a note with a release trigger is released, the engine must play the release
sample matching the note and current dynamic.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::release::fires_on_note_off`

### AC-002 — Release level scales with how the note was played

When a release sample fires, the engine must scale its level by hold duration,
current dynamic (CC1), and release velocity where available.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::release::level_scaling`

### AC-003 — Sustain pedal defers release

When CC64 is held, the engine must keep notes sustaining and must not fire
release triggers until the pedal lifts.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::release::sustain_pedal_defers`

### AC-004 — Pedal-up releases are staggered

When the sustain pedal lifts on several held notes, the engine must stagger their
release triggers (±10–30 ms) rather than firing them all on the same sample.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::release::staggered_pedal_up`

## Open questions

- [ ] (non-blocking) Half-pedaling (CC64 partial values) — model partial damping
  now, or treat CC64 as a binary on/off for v1?
- [ ] (non-blocking) Is release-trigger presence a per-articulation flag or a
  per-instrument capability?

## Affected areas

- `crates/daw-dsp/src/levain/release/` (note-off handling, release-sample
  selection, level scaling, pedal state, stagger)
- `crates/daw-dsp/src/levain/voice/` (release-stage voice accounting)

## Dropped from sources

- What release triggers capture per family (bow lift, breath stop, damper) —
  asset/sampling guidance, not an engine requirement.
- Sympathetic open-string resonance on release — physical-modeling augmentation,
  in `SPEC-orchestra-physical-modeling`.
