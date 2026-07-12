---
type: spec
id: SPEC-arrangement-clip-interactions
title: Arrangement professional clip interactions
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Arrangement professional clip interactions

## Intent

Bring professional clip-level interactions to the arrangement timeline: Alt-drag duplicate,
duplicate-forward, ripple insert and ripple move (ripple delete already exists), time-range
selection with its operations, loop-from-selection, and audio scrub on the beat ruler. Each
respects the existing ripple toggle and integrates with undo.

## Non-goals

- Piano-roll note interactions (`../workflow-ui/spec.md`).
- Ripple delete — already implemented.

## Requirements

### AC-001 — Alt-drag duplicates selected clips

Alt-dragging selected clips must leave originals in place and drop grid-aligned copies in one undo
entry; Alt-drag on empty space stays rubber-band.

Verify with: `manual` — Alt-drag a clip and confirm the original stays and one undo removes the copy

### AC-002 — Ctrl/Cmd+D duplicates clips forward

Ctrl/Cmd+D must place copies immediately after the selection (stacking on repeat) and be a no-op
when nothing is selected.

Verify with: `pnpm test:run -- Arrangement duplicateClipsForward`

### AC-003 — Ripple insert pushes subsequent clips

Inserting or drawing a clip in ripple mode must push later clips forward by the inserted clip's
duration.

Verify with: `pnpm test:run -- Arrangement planRippleInsert`

### AC-004 — Ripple move reflows the gap

Moving a clip in ripple mode must close the gap at the source and open space at the destination,
respecting the per-track vs all-tracks toggle.

Verify with: `pnpm test:run -- Arrangement planRippleMove`

### AC-005 — Time-range selection supports range operations

Shift-clicking the beat ruler must select a time range across tracks that supports delete (with
ripple), insert silence, duplicate, bounce, set-loop, and export.

Verify with: `pnpm test:run -- Arrangement timeSelection`

### AC-006 — Loop-from-selection sets the transport loop

Ctrl/Cmd+L must set the transport loop region to the selected clips' or active time range's
start/end beats.

Verify with: `pnpm test:run -- Arrangement loopFromSelection`

### AC-007 — Beat-ruler drag scrubs with audio preview

Click-and-drag on the beat ruler must scrub the playhead with audio preview at drag speed without
entering play mode; a single click still seeks.

Verify with: `manual` — drag on the beat ruler and confirm audible scrub; single-click and confirm a plain seek

## Open questions

- [ ] (non-blocking) Should insert-silence default to per-track or all-tracks? Proposed: follow the ripple toggle.

## Affected areas

- `src/modules/Workspace/presentations/hooks/useTimelineInteractions.ts`
- `src/modules/Arrangement/useCases/rippleDelete/` (add `planRippleInsert`, `planRippleMove`)
- new `timeSelection` state in `WorkspaceState`

## Dropped from sources

- The source's global phasing/exit-gate scaffolding — this spec stands alone.
