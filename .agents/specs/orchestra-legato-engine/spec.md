---
type: spec
id: SPEC-orchestra-legato-engine
title: Orchestra legato engine
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Orchestra legato engine

## Intent

Make Orchestra's note-to-note transitions sound played, not crossfaded: use
recorded transition samples where they exist, adapt transition speed to playing
speed, track which notes are new versus sustained in chords, and fall back to a
synthetic pitch slide when no recorded transition covers the interval.

## Non-goals

- The recorded transition sample assets (asset work).
- Articulation switching at note-on — owned by
  `SPEC-orchestra-articulation-system`.
- Release behavior on the trailing note — owned by
  `SPEC-orchestra-release-triggers`.

## Requirements

### AC-001 — A recorded transition plays between overlapping notes

When a new note arrives while a previous note is sustaining and a recorded
transition exists for that interval, dynamic, and type, the engine must play the
transition sample rather than re-attacking the new note.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::legato::uses_recorded_transition`

### AC-002 — Transition type is chosen from playing input

When a legato transition fires, the engine must select slurred versus portamento
from the configured velocity/CC criterion for the overlapping note.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::legato::transition_type_select`

### AC-003 — Transition timing adapts to playing speed

When the time since the previous note-on is shorter, the engine must shorten the
transition (full → standard → abbreviated) so fast passages use quick
transitions and slow passages use longer ones.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::legato::adaptive_speed`

### AC-004 — Polyphonic legato re-triggers only the changed voice

When a held chord changes by one note, the engine must trigger a legato
transition only for the nearest moving voice and leave the sustained voices
unchanged.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::legato::polyphonic_divisi`

### AC-005 — Out-of-range intervals fall back to synthetic legato

When no recorded transition covers the interval, the engine must perform a
synthetic legato — fade out the old note, pitch-slide to the new note, fade in —
rather than a hard re-attack.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::legato::synthetic_fallback`

### AC-006 — The transition tail crossfades into the sustain equal-power

When the transition sample ends, the engine must crossfade its tail into the new
note's sustain with an equal-power curve so there is no seam.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::legato::tail_crossfade`

## Open questions

- [ ] (non-blocking) Adaptive-speed thresholds (the slow/medium/fast boundaries)
  — fixed defaults or per-instrument tunable?
- [ ] (non-blocking) For synthetic portamento, default to linear-in-cents or
  exponential-approach pitch curve?

## Affected areas

- `crates/daw-dsp/src/levain/legato/` (transition lookup, adaptive timing,
  polyphonic voice tracking, synthetic fallback, tail crossfade)
- `crates/daw-dsp/src/levain/voice/` (per-voice pitch list for divisi tracking)

## Dropped from sources

- Brass rip/fall and run transition types as distinct recorded sets — represented
  as transition types in the data model; their sample coverage is asset work.
- Recording-spec coverage counts ("~25 intervals × 3 dynamics × 2 types") —
  asset-production guidance, not an engine requirement.
