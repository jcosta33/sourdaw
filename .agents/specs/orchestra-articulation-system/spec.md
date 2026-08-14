---
type: spec
id: SPEC-orchestra-articulation-system
title: Orchestra articulation system
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Orchestra articulation system

## Intent

Let an Orchestra instrument switch between recorded articulations (sustain,
spiccato, tremolo, legato, pizzicato, and the rest) through every method players
expect — keyswitches, per-note articulation IDs, velocity ranges, and CC — and
resolve the active articulation deterministically on the audio thread.

## Non-goals

- The DAW piano-roll articulation lane and keyswitch-management UI — owned by
  `SPEC-articulation-maps`.
- Legato transitions between notes — owned by `SPEC-orchestra-legato-engine`.
- Defining the recorded sample assets per articulation (asset work).

## Requirements

### AC-001 — Keyswitching selects the active articulation

When a configured keyswitch note (below the playable range) is received, the
engine must set the active articulation, honoring its latching-or-momentary
mode.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::articulation::keyswitch_select`

### AC-002 — Per-note articulation IDs override keyswitch state

When a note-on carries an articulation ID, the engine must play that note with
the mapped articulation regardless of the current keyswitch state.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::articulation::note_id_override`

### AC-003 — Velocity ranges can select articulation

When velocity-based switching is enabled, a note's velocity must select the
articulation whose configured velocity range contains it.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::articulation::velocity_split`

### AC-004 — A dedicated CC can select articulation by range

When CC-based switching is configured, the selecting CC's value must choose the
articulation whose value range contains it.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::articulation::cc_select`

### AC-005 — Articulation resolution is a deterministic state machine

When the same ordered stream of MIDI, CC, and timing events is replayed, the
engine must resolve the identical active articulation at each note-on.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::articulation::deterministic_state`

### AC-006 — An articulation map is loadable per instrument

When an instrument loads an articulation map (e.g. "Violins 1 — Standard"), the
engine must bind each mapped keyswitch/ID to its articulation as defined by the
map.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::articulation::map_binding`

## Open questions

- [ ] (non-blocking) When two switching methods disagree at the same note-on
  (e.g. a velocity split and an explicit articulation ID), which wins? Current
  assumption: per-note ID is highest priority (AC-002).
- [ ] (non-blocking) Is the CC-switching channel fixed to the UACC convention
  (CC32) or fully configurable per instrument?

## Affected areas

- `crates/daw-dsp/src/levain/articulation/` (switching, scripting state machine,
  keyswitch/CC/velocity maps)
- `crates/daw-core/` (`ArticulationId` newtype, note articulation attribute)

## Dropped from sources

- The full essential-articulation catalogues per section (strings/brass/winds/
  percussion lists) — sample-content guidance, not engine requirements; an
  instrument's available articulations are defined by its loaded assets.
- Choir/vocal vowel articulations and the word-builder — stretch goals; out of
  scope for this engine spec.
- MPE per-note control of articulation — expression concern, in
  `SPEC-orchestra-expression-dynamics`.
