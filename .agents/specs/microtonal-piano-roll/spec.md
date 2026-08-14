---
type: spec
id: SPEC-microtonal-piano-roll
title: Adaptive piano roll for arbitrary N-TET
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Adaptive piano roll for arbitrary N-TET

## Intent

Make the piano roll render the active tuning's steps-per-octave instead of an
unconditional 12 rows: 19-EDO shows 19 rows, 31-EDO shows 31, with custom note names from
`.ascl` metadata (or scale-degree + cents fallback), five controller-layout modes
(All/Black/White/Closest/Custom), and the existing keyboard workflow intact.

## Non-goals

- The tuning table the row count derives from (see `microtuning-engine`).
- Scala/`.ascl` parsing (see `scala-tuning-formats`).
- Non-destructive key-change folding (see `scale-folding`).

## Requirements

### AC-001 — Row count tracks steps-per-octave

Loading 19-EDO must render 19 rows/octave, 31-EDO 31, 12-TET 12 — verified by
a piano-roll DOM snapshot per tuning.

Verify with: `pnpm test:run -- pianoRollRowCountByTuning`

### AC-002 — Note names from .ascl

Named degrees from an `.ascl` must appear on rows without truncation at default zoom;
zoom-out collapses to scale-degree numbers.

Verify with: `manual` — load an .ascl tuning and confirm named-degree labels render, collapsing on zoom-out

### AC-003 — Drawn note hits the right frequency

Drag-drawing a note in a 31-EDO view must place the event on the row whose
`frequencies[index]` matches the played frequency within 1e-9 Hz.

Verify with: `pnpm test:run -- pianoRollDrawNTetFrequency`

### AC-004 — Controller-layout switching is live

Switching All Keys → Closest in Pitch must remap physical-keyboard shortcuts without rebuild
or relaunch.

Verify with: `pnpm test:run -- pianoRollControllerLayoutSwitch`

### AC-005 — No long-task regression

Switching between 12-row and 53-row layouts must not breach the UI main-thread long-task
budget.

Verify with: `pnpm test:run -- pianoRollLayoutSwitch`

## Open questions

- [ ] (non-blocking) Default controller-layout mode for newly opened microtonal projects.
  Default: All Keys.

## Affected areas

- piano-roll renderer (parameterized on steps-per-octave)
- keyboard-shortcut layer

## Dropped from sources

- None — scopes §10.4 directly.
