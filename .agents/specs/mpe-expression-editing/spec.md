---
type: spec
id: SPEC-mpe-expression-editing
title: Per-note MPE expression editing
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Per-note MPE expression editing

## Intent

Deepen expression editing from per-clip CC lanes to per-note MPE: dedicated expression lanes bound
to individual notes (pitch bend, CC74 timbre, pressure, release velocity), per-note transforms
(random/spread/humanize on expression data), recording physical controller movements into
note-bound expression, and a density-management strategy for dense MPE data.

## Non-goals

- The per-clip `ExpressionPanel` and existing velocity/pressure/slide/pitchBend lanes — already exist.
- General note CRUD and timing/velocity transforms (`../workflow-ui/spec.md`).

## Requirements

### AC-001 — Per-note expression lanes edit individual notes

Dedicated lanes bound to individual notes must edit pitch bend, CC74, pressure, and release
velocity, overlaying curves when multiple notes are selected.

Verify with: `pnpm test:run -- MIDI noteExpressionLanes`

### AC-002 — Per-note transforms reshape expression data

Random, spread, and humanize must apply at the per-note expression level, not just timing/velocity.

Verify with: `pnpm test:run -- MIDI noteExpressionTransforms`

### AC-003 — Controller input records into note-bound expression

Physical controller movement (mod wheel, expression pedal, breath) must record into the focused
expression dimension of selected notes, not clip-level CC lanes.

Verify with: `manual` — move a controller with notes selected and confirm note-bound expression is written

### AC-004 — Dense MPE data stays legible

Dense expression overlays must collapse or dim in the piano roll, expand on hover, and offer a
dedicated Expression View with full per-note lanes.

Verify with: `manual` — load a dense MPE clip and confirm overlays dim, expand on hover, and Expression View shows per-note lanes

## Open questions

- [ ] (non-blocking) Default focused expression dimension for recording? Proposed: last-edited lane.

## Affected areas

- generalize `Levain/ExpressionPanel.tsx` + Workspace velocity/pressure/slide/pitchBend lanes to per-note
- `MidiNote` `pressure`/`slide`/`pitchBend` fields

## Dropped from sources

- None — section I maps cleanly to one feature area.
