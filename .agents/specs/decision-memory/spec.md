---
type: spec
id: SPEC-decision-memory
title: Passive decision memory
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
  - intake/differentiators.md
  - intake/future-spec.md
---

# Passive decision memory

## Intent

Capture why creative choices were made — why a variant was promoted over
alternatives, why an AI suggestion was accepted — generated passively from user
actions rather than as mandatory documentation. Surface it inside the existing undo
history rather than as a new mandatory panel.

## Non-goals

- A formal Decision Log panel with manual decision authoring (future-spec K vision).
- Lightweight goal annotations (see `timeline-goals`).
- Loose-material capture (see `capture-inbox`).

## Requirements

### AC-001 — Action history entries carry optional decision context

An action history entry must support an optional decision context (reason,
alternatives, promoted-from, ai-generated) without requiring it on every entry.

Verify with: `pnpm test:run -- decisionContext`

### AC-002 — Decisions are auto-generated at key actions

Accepting a ghost clip, promoting a variant, and applying an AI action must each
auto-record a decision context describing the choice and its alternatives.

Verify with: `pnpm test:run -- autoDecisionCapture`

### AC-003 — Decisions surface in existing undo history

Entries with a decision context must show an expandable detail row in the existing
undo history panel — no separate decision panel.

Verify with: `manual` — promote a variant, open undo history, confirm an expandable "promoted over N alternatives" row

### AC-004 — Decisions are searchable

Decision contexts must be searchable from the existing command palette alongside
clips and notes.

Verify with: `pnpm test:run -- decisionSearch`

### AC-005 — Decisions persist with action history

Decision contexts must persist with the action history store so they survive reload.

Verify with: `pnpm test:run -- actionHistoryPersistence`

## Open questions

- [ ] (non-blocking) Should decisions sync across collaborators or stay device-local
  like the rest of action history? Default: device-local, matching action history.

## Affected areas

- `src/modules/Workspace/stores/actionHistoryStore.ts` (decisionContext field)
- `src/modules/Arrangement/useCases/clip/acceptGhostClip.ts`, variant promote use case
- existing undo history panel and command palette

## Dropped from sources

- Decision cards linking intents, artifacts, and provenance with collaborator review
  flows (future-spec K) — deferred; v1 is passive capture surfaced in undo history.
