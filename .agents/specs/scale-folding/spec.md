---
type: spec
id: SPEC-scale-folding
title: Non-destructive scale folding for key changes
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Non-destructive scale folding for key changes

## Intent

Let a project-wide key/scale change remap existing MIDI clips automatically and
non-destructively. Each note decomposes into `(scaleDegree, octave, chromaticOffset)` in
its stored source scale, maps to the destination scale, and reconstructs against the new
root — a pure function evaluated at display/playback, with a "Bake" to commit, and
`mod stepsPerOctave` generalization for non-12-TET.

## Non-goals

- The tuning engine / table (see `microtuning-engine`).
- The piano-roll rendering of folded notes (see `microtonal-piano-roll`).
- Scala file IO (see `scala-tuning-formats`).

## Requirements

### AC-001 — Documented fold mapping

C Major → D Dorian on the reference fixture must produce MIDI matching the documented mapping
(C→D, E-F gap → A-B gap, G# passing tone → B♭).

Verify with: `pnpm cargo:test -- -p daw-core scale_fold_reference_fixture`

### AC-002 — Pure-function reversibility

Changing scale and back must produce byte-identical original MIDI (property test).

Verify with: `pnpm cargo:test -- -p daw-core scale_fold_reversible`

### AC-003 — Proportional chromatic remap

Out-of-scale chromatic notes must remap with `newOffset = round(offset × dstGap / srcGap)`.

Verify with: `pnpm cargo:test -- -p daw-core scale_fold_chromatic_proportional`

### AC-004 — Bake commits and clears source scale

Baking must replace stored MIDI in place and clear `sourceScale`; later scale changes no
longer re-fold the baked clip.

Verify with: `pnpm cargo:test -- -p daw-core scale_fold_bake`

### AC-005 — Cross-EDO fold degrades, never crashes

A 31-EDO source folding to a 19-EDO destination must round out-of-scale degrees to the
nearest destination degree with a logged warning, not an error.

Verify with: `pnpm cargo:test -- -p daw-core scale_fold_cross_edo`

## Open questions

- [ ] (non-blocking) Whether `sourceScale` is stored per clip or per note. Default: per
  clip at creation.

## Affected areas

- `crates/daw-core/` (fold function, clip `sourceScale`)
- key/scale change command, Bake operation

## Dropped from sources

- None — scopes §10.4a directly.
