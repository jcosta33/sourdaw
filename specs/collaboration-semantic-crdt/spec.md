---
type: spec
id: SPEC-collaboration-semantic-crdt
title: Semantic collaboration — conflict views and attribution
status: draft
owner: The Sourdaw team
sources:
  - intake/future-spec.md
---

# Semantic collaboration — conflict views and attribution

## Intent

Raise collaboration above raw-note CRDT merge to the semantic objects Sourdaw models:
intents, decisions, memory artifacts, variants, and performance DNA merge concurrently;
disagreements surface as readable semantic conflict views (harmony, expression, chosen
take, provenance, constraint sets) rather than byte conflicts; every collaborator-made
branch is attributable.

## Non-goals

- The base CRDT document/sync transport (see existing `crdt`).
- Variant branching and merge mechanics (see `variation-native-clips`).
- Exportable provenance reporting (see `export-provenance`).
- Real-time transport/clock sync between peers (see `collaboration-transport-sync` if pursued).

## Requirements

### AC-001 — Concurrent semantic-object editing

Two peers must concurrently edit intents, decisions, memory artifacts, variants, and
performance DNA on the same project and converge to one state with no lost edits.

Verify with: `pnpm test:run -- semanticCrdtConvergence`

### AC-002 — Branch proposals over silent overwrite

A collaborator's conflicting change must land as a proposed branch, never a silent
overwrite of the mainline object.

Verify with: `pnpm test:run -- collaborationBranchProposal`

### AC-003 — Semantic conflict views

A divergence in harmony, expression, chosen take, provenance status, or constraint set
must render a typed conflict view naming the dimension in disagreement, not a raw text diff.

Verify with: `manual` — produce a harmony disagreement between two peers and confirm a "harmony" conflict view appears

### AC-004 — Collaborator attribution

Every collaborator-generated branch must carry attributable identity.

Verify with: `pnpm test:run -- collaborationAttribution`

### AC-005 — Role-scoped trust defaults

Trust-mode defaults must be assignable per user role so a collaborator's proposals can
default to a stricter mode than the owner's.

Verify with: `pnpm test:run -- collaborationRoleTrustDefaults`

### AC-006 — Provenance includes collaborator identity

Provenance must include collaborator identity where available.

Verify with: `pnpm test:run -- collaborationAttribution`

## Open questions

- [ ] (non-blocking) Identity source for attribution (local keypair vs external) — resolve
  with the provenance signing decision in `export-provenance`.

## Affected areas

- `src/modules/Collaboration/` (semantic merge, conflict views)
- CRDT schema for semantic objects, provenance manifest

## Dropped from sources

- Peer discovery / transport mechanics — out of scope here; lives with `crdt`.
