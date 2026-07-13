---
type: spec
id: SPEC-timeline-goals
title: Lightweight goal attachment
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
  - intake/differentiators.md
  - intake/future-spec.md
---

# Lightweight goal attachment

## Intent

Let the user attach practical requests — "make this chorus wider", "tighten this
groove", "darken this pad without losing attack" — to timeline ranges as lightweight,
local, optional annotations that can optionally feed an AI operation. This is the
restrained realization of the "creative intent" idea: practical annotation plus
actionable tooling, not a formal ontology of creativity.

## Non-goals

- A heavy intent object model with statuses, evidence references, and satisfaction
  scores (future-spec A vision, deliberately not built).
- Capture of voice/reference material (see `capture-inbox`).
- Decision rationale capture (see `decision-memory`).
- The AI generation pipelines a goal might feed.

## Requirements

### AC-001 — A goal anchors to a timeline range

A goal must store its text, a start/end beat, an optional target track, a resolved
flag, and a created-at timestamp.

Verify with: `pnpm test:run -- timelineGoalModel`

### AC-002 — Create a goal from the timeline

The user must be able to add a goal to a selected range via the timeline context menu.

Verify with: `manual` — select bars 9–16, add a goal, confirm a distinct dashed range marker appears

### AC-003 — Run a goal as an AI prompt

A "Run as AI prompt" action must pipe the goal text plus its beat range as selection
context into the existing AI execution pipeline.

Verify with: `pnpm test:run -- runGoalAsPrompt`

### AC-004 — Goals are listed for a selected range

When a range is selected, the inspector must list the goals attached to it with a
resolve toggle.

Verify with: `pnpm test:run -- goalsForRange`

### AC-005 — Goals persist with the project

Goals must serialize into project data and survive save/load and collaboration sync.

Verify with: `pnpm test:run -- timelineGoalPersistence`

### AC-006 — A goal renders as a distinct range marker

A goal must render as a distinct range marker on the timeline.

Verify with: `manual` — select bars 9–16, add a goal, confirm a distinct dashed range marker appears

## Open questions

- [ ] (non-blocking) Reuse the existing marker store or add a dedicated goal store?
  Default: a lightweight dedicated goal store in the Arrangement module.

## Affected areas

- `src/modules/Arrangement/models/Track.ts` (TimelineGoal type), `stores/`, `useCases/`
- timeline renderer (range markers) and inspector list
- existing `executeAppAction` pipeline (run-as-prompt)

## Dropped from sources

- Intent normalization into structured goal categories and a planner producing action
  plans (future-spec A technical) — deliberately dropped per the differentiators' warning
  against intent bureaucracy.
