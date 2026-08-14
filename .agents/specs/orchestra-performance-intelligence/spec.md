---
type: spec
id: SPEC-orchestra-performance-intelligence
title: Orchestra performance intelligence
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra performance intelligence

## Intent

Make Orchestra play like an ensemble rather than a stack of unison samples:
divide chords across virtual desks, pick articulations automatically from how a
passage is played, and add ensemble realism (attack spread, pitch convergence,
dynamic bloom) and section-size scaling.

## Non-goals

- The CC1/CC11/velocity expression model and single-note humanization — owned by
  `SPEC-orchestra-expression-dynamics`.
- Phrase-level tools driven by imported MIDI — owned by
  `SPEC-orchestra-score-import`.
- Physical-modeling per-voice variation — owned by
  `SPEC-orchestra-physical-modeling`.

## Requirements

### AC-001 — Auto-divisi splits chords across the section

When auto-divisi is on and a chord is played, the engine must distribute the
section across the chord notes and reduce per-note level proportionally rather
than playing the full section on every note.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::ensemble::auto_divisi_split`

### AC-002 — Auto-articulation selects from note duration and overlap

When auto-articulate is on, the engine must choose the articulation from the
note's measured duration and overlap (short→staccato, overlapping→legato,
long→sustain) using the configured thresholds.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::ensemble::auto_articulate`

### AC-003 — Section players are spread in attack timing

When a section note sounds, the engine must offset each virtual player's onset by
a seeded random spread (±5–20 ms) so the attack is broadened, not coincident.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::ensemble::attack_spread`

### AC-004 — Section pitch converges after onset

When a section note begins, the engine must start virtual players slightly
detuned and converge them toward unison over the configured time.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::ensemble::pitch_convergence`

### AC-005 — Section size scales by player multiplication

When section size is increased, the engine must layer additional virtual players
with per-instance tuning, timing, level, and pan offsets rather than only raising
gain.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::ensemble::section_size_scaling`

## Open questions

- [ ] (non-blocking) Divisi distribution table (2-note 8+8, 3-note 5+5+6, …) —
  fixed defaults or configurable per section?
- [ ] (non-blocking) Should auto-articulate be overridable per note from the
  piano roll, and does that belong here or in `SPEC-articulation-maps`?

## Affected areas

- `crates/daw-dsp/src/levain/ensemble/` (divisi, auto-articulate, attack spread,
  pitch convergence, dynamic bloom, section-size layering)
- `crates/daw-dsp/src/levain/voice/` (virtual-player voice grouping)

## Dropped from sources

- Dynamic-bloom shaping is covered by the per-note humanization knob from
  `SPEC-orchestra-expression-dynamics`; only its ensemble-scoped form is here.
- Marketing-derived realism claims about reference libraries — design rationale,
  not requirements.
