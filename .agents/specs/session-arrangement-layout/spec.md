---
type: spec
id: SPEC-session-arrangement-layout
title: Session and arrangement side-by-side
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Session and arrangement side-by-side

## Intent

Show the session-view clip launcher and the arrangement timeline simultaneously in one resizable
split — no tab-switching, unlike Ableton — both bound to the same transport and track model. This
extends the existing `SessionView.tsx` into a vertical panel beside the arrangement.

## Non-goals

- New clip-launching behavior or scene logic beyond what `SessionView.tsx` already provides.
- AI ghost surfaces (`../ai-ghost-surfaces/spec.md`).

## Requirements

### AC-001 — Both views are visible at once

The session view and the arrangement timeline must be displayable simultaneously without
tab-switching.

Verify with: `manual` — open both and confirm the launcher and timeline are visible together

### AC-002 — The split is resizable

The boundary between the session panel and the arrangement must be draggable to resize.

Verify with: `manual` — drag the split divider and confirm both panes resize

### AC-003 — Both views share transport and track model

Both views must read from the same transport and track model so playback and track state stay in
sync.

Verify with: `pnpm test:run -- Workspace sessionArrangementSharedState`

## Open questions

- [ ] (non-blocking) Default orientation/position of the session panel? Proposed: left vertical panel.

## Affected areas

- `src/modules/Workspace/presentations/views/SessionView.tsx`
- arrangement layout / resizable split container

## Dropped from sources

- None — this section maps cleanly to one feature.
