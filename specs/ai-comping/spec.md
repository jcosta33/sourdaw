---
type: spec
id: SPEC-ai-comping
title: AI-assisted comping
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
---

# AI-assisted comping

## Intent

Score each take segment by pitch accuracy, timing alignment, and energy/clarity, then
auto-generate a suggested "best comp" the user can audition before committing. Users
weight the criteria (e.g. emotional intensity for ballads, timing precision for metal)
to bias the result for different musical contexts.

## Non-goals

- The underlying comping infrastructure (take lanes, swipe selection, crossfades,
  group comping) — that already exists; this adds scoring on top.
- MIDI comping (MIDI notes are already discrete/quantizable); analysis is audio-takes only.
- Pitch correction itself (see the existing `knead` feature).

## Requirements

### AC-001 — Score takes by pitch, timing, and energy

For each audio take segment, the system must compute pitch accuracy, timing accuracy,
and energy/clarity scores using the existing pitch- and onset-detection pipelines.

Verify with: `pnpm test:run -- scoreTakeSegment`

### AC-002 — Suggest a best comp from region scores

For each region boundary, the system must pick the highest weighted-score take and
output a suggested comp as standard comp regions applyable via existing comping.

Verify with: `pnpm test:run -- suggestBestComp`

### AC-003 — User-weighted criteria

The user must be able to weight pitch accuracy vs timing precision vs energy.

Verify with: `pnpm test:run -- suggestBestComp`

### AC-004 — Suggestion is auditionable before commit

The suggested comp must appear as a distinct preview that the user can accept, modify,
or dismiss without overwriting user-created comps.

Verify with: `manual` — score 3 takes, audition the suggested comp, then dismiss it and confirm no comp changed

### AC-005 — Analysis runs off the UI thread

Take analysis must run on a background thread (Rust backend), not blocking the UI.

Verify with: `pnpm test:run -- suggestBestComp`

### AC-006 — Suggestion changes with the weighting

When the user changes the criteria weighting, the suggested comp must change accordingly.

Verify with: `pnpm test:run -- suggestBestComp`

## Open questions

- [ ] (non-blocking) Should energy/clarity weighting default to equal with pitch/timing,
  or lower? Default: equal thirds, user-adjustable.

## Affected areas

- `src/modules/Arrangement/useCases/comping/` (suggestBestComp)
- reuses Knead pitch detection and onset detection
- `src/modules/Workspace/presentations/components/Inspector/TakesSection.tsx`

## Dropped from sources

- Tonal-consistency scoring beyond energy/clarity — deferred; v1 uses pitch + timing +
  energy.
