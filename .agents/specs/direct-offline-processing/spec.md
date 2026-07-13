---
type: spec
id: SPEC-direct-offline-processing
title: Non-destructive Direct Offline Processing (DOP)
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
---

# Non-destructive Direct Offline Processing (DOP)

## Intent

Cubase-style Direct Offline Processing: apply a plugin to a clip region as a recorded,
non-destructive operation rather than a baked render. Operations stack, can be
reordered, edited, disabled, or removed after the fact, and only render when needed.

## Non-goals

- Timeline bus-level region effects (that is the separate `adjustment-layer` feature).
- Freeze/flatten/bounce destructive rendering (see existing `freeze-flatten-bounce`).
- Real-time insert effects (these are offline operations on clip content).

## Requirements

### AC-001 — Clips carry an ordered DOP stack

A clip must hold an ordered list of DOP operations, each storing plugin type,
parameter values, affected region, enabled flag, and order.

Verify with: `pnpm test:run -- dopStackModel`

### AC-002 — Operations are reorderable and removable post-hoc

The user must be able to reorder, disable, and remove DOP operations on a clip after
they are added.

Verify with: `pnpm test:run -- dopReorderRemove`

### AC-003 — Lazy rendering

DOP operations must render on demand (or from cache) at playback, not eagerly bake the
clip's source content.

Verify with: `pnpm test:run -- dopLazyRender`

### AC-004 — DOP stack persists with the project

A clip's DOP stack must serialize into project data and survive save/load.

Verify with: `pnpm test:run -- dopPersistence`

### AC-005 — Inspector exposes the stack

The clip inspector must show the DOP stack with reorder handles and enable/disable
toggles.

Verify with: `manual` — add two DOP operations, reorder them, remove the first, confirm audio updates

### AC-006 — Edits change the audible result

After a DOP operation is reordered, disabled, or removed on a clip, the audible result
must reflect the change.

Verify with: `pnpm test:run -- dopReorderRemove`

## Open questions

- [ ] (non-blocking) Render caching granularity (per-operation vs whole-stack) — default
  whole-stack cache invalidated on any change; revisit if costly.

## Affected areas

- `src/modules/Arrangement/models/Track.ts` (DopOperation, Clip.dopStack)
- playback scheduler (on-the-fly render / cache)
- clip inspector UI

## Dropped from sources

- A shared offline-render farm for DOP — out of scope; v1 renders on the existing
  offline path.
