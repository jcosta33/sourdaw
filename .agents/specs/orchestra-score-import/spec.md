---
type: spec
id: SPEC-orchestra-score-import
title: Orchestra score import and phrase tools
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra score import and phrase tools

## Intent

Let Orchestra read a MIDI/SMF file as a score reference — parsed off the audio
thread into a precompiled event stream with a tempo map — and apply phrase-level
humanization (microtiming, velocity shaping, articulation variation) so a
written passage becomes a performed one.

## Non-goals

- Real-time playing input handling — owned by `SPEC-orchestra` and the
  articulation/expression specs.
- Ensemble realism applied to live playing — owned by
  `SPEC-orchestra-performance-intelligence`.
- The DAW's own MIDI editor / piano roll.

## Requirements

### AC-001 — SMF parsing happens off the audio thread

When an SMF file is imported, the engine must parse it on a non-audio thread and
hand the audio side a precompiled event stream, never parsing on the hot path.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::score::parse_off_thread`

### AC-002 — Tempo meta-events build a piecewise tempo map

When an SMF contains tempo changes, the importer must build a piecewise tempo map
and convert tick times to seconds for scheduling.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::score::tempo_map_ticks_to_seconds`

### AC-003 — Phrase microtiming is applied deterministically

When phrase humanization is enabled, the importer must offset note timings within
the configured range using a seeded RNG, reproducing identical timing for a fixed
seed.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::score::phrase_microtiming_seeded`

### AC-004 — Velocity shaping follows the phrase contour

When phrase shaping is enabled, the importer must apply crescendo/diminuendo
velocity drift across a phrase rather than uniform velocity.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::score::velocity_shaping`

## Open questions

- [ ] (non-blocking) SMPTE-format SMF timing (vs ticks-per-quarter) — support in
  v1 or defer?
- [ ] (non-blocking) Should articulation prediction from the score live here or
  reuse the auto-articulate logic in `SPEC-orchestra-performance-intelligence`?

## Affected areas

- `crates/daw-dsp/src/levain/score/` (SMF import, tempo map, phrase humanization)
- the non-audio import path that feeds the precompiled event stream to the engine

## Dropped from sources

- Articulation prediction as a distinct subsystem — overlaps auto-articulate in
  `SPEC-orchestra-performance-intelligence`; cross-referenced, not duplicated.
- `midly` crate choice — an implementation detail behind AC-001's observable
  (allocation-free, off-thread parse).
