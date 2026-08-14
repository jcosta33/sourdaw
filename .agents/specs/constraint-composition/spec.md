---
type: spec
id: SPEC-constraint-composition
title: Constraint-driven composition
status: draft
owner: The Sourdaw team
sources:
  - intake/future-spec.md
---

# Constraint-driven composition

## Intent

Make generative assistance respect explicit musical, technical, and rights constraints. A
Constraints Editor attaches hard constraints, soft preferences, and banned outcomes to an
intent, track, section, or generation operation; engines consume normalized constraint
payloads; when constraints conflict, the system explains which ones, rather than silently
violating or failing.

## Non-goals

- The generative engines themselves (see existing `audio-generation`, `midi-generation`).
- AI trust modes / approval gating (see existing `ai-trust-modes`).
- The performance-expression model the constraints reference (see existing
  `performance-expression`).

## Requirements

### AC-001 — Constraints attach at four scopes

A constraint must be attachable to an intent, a track, a section, or a single generation
operation, and persist with the project.

Verify with: `pnpm test:run -- constraintScopes`

### AC-002 — Hard / soft / banned semantics

The editor must distinguish hard constraints, soft preferences, and banned outcomes.

Verify with: `pnpm test:run -- constraintKinds`

### AC-003 — Constrained generation or explained infeasibility

A reharmonization request that preserves melody range and excludes unsupported
articulations must produce constrained branches, or, when infeasible, name the
conflicting constraints.

Verify with: `manual` — request a constrained reharmonization with a deliberate contradiction; confirm it names the conflict

### AC-004 — Solver detects contradictions and missing capabilities

The constraint solver must report feasibility, internal contradictions, and dependencies
on unavailable capabilities before generation runs.

Verify with: `pnpm cargo:test -- -p daw-core constraint_solver_feasibility`

### AC-005 — Constraints are stored and replayable

A stored constraint set must replay against a later generation operation producing the
same admissibility decision.

Verify with: `pnpm cargo:test -- -p daw-core constraint_replay`

### AC-006 — Payload encodes constraint kind

The normalized payload must encode whether each constraint is a hard constraint, a soft
preference, or a banned outcome.

Verify with: `pnpm test:run -- constraintKinds`

## Open questions

- [ ] (non-blocking) Whether ready-made constraint templates ship in v1 or follow once the
  solver is proven. Default: ship two templates (singable top line, no parallel fifths).

## Affected areas

- `crates/daw-core/` (constraint model + solver), generation request payloads
- Constraints Editor UI (chips, expandable rules)

## Dropped from sources

- None — this spec scopes section O directly.
