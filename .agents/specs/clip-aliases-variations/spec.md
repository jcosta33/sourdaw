---
type: spec
id: SPEC-clip-aliases-variations
title: Clip aliases and variations
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Clip aliases and variations

## Intent

Extend the existing pattern-instance pooling to make automation clips reusable, support
per-instance property overrides that still sync non-overridden fields, surface track alternatives
as switchable variation lanes in the timeline, and add a non-destructive groove-template library
with an intensity control.

## Non-goals

- New MIDI pattern-instance plumbing beyond reusing `patternInstance`/`poolId`.
- The groove extraction engine itself — already exists; this adds the library and overlay.

## Requirements

### AC-001 — Automation clips become reusable pooled objects

Automation clips must link instances via the existing `poolId` pattern so edits to the source
propagate to all instances.

Verify with: `pnpm test:run -- Arrangement automationClipPool`

### AC-002 — Per-instance overrides sync the rest

An instance must override specific properties (note velocity, automation point, transposition)
while non-overridden fields continue to sync.

Verify with: `pnpm test:run -- Arrangement perInstanceOverride`

### AC-003 — Variation lanes are switchable in the timeline

The existing `TrackAlternative` system must surface as variation lanes that are visible and
switchable per playback pass or scene in the timeline UI.

Verify with: `manual` — switch a track's variation in the timeline and confirm playback follows

### AC-004 — Groove templates apply non-destructively

A groove-template library (built-in + user-saved) with a 0–100% intensity slider must apply as a
removable overlay that never bakes note positions.

Verify with: `pnpm test:run -- MIDI grooveTemplate`

### AC-005 — Reset override reverts to the parent

"Reset override" must revert an overridden instance to the parent.

Verify with: `pnpm test:run -- Arrangement perInstanceOverride`

## Open questions

- [ ] (non-blocking) Should groove templates be project-embedded or standalone files? Proposed: both.

## Affected areas

- `patternInstance/`, `AutomationObject.poolId`, `TrackAlternative` model
- `grooveExtraction/` (template library + non-destructive overlay)

## Dropped from sources

- None — section H maps cleanly to one feature area.
