> **Legacy template — superseded by the Swarm workspace.** Canonical templates now live in `../sourdaw-hq/templates/` (`spec.md`, `task.md`, `review.md`); audits map to `../sourdaw-hq/inventory/` or a co-located `../sourdaw-hq/specs/<feature>/audit.md`. Author new specs, audits, and research in the workspace, not here. This file is kept for reference only.

# <Feature name>

## Context

Why this feature exists. What problem it solves.
Reference relevant research if any: `../sourdaw-hq/specs/<feature>/research.md`

---

## Goal

One or two sentences. What will be true when this is done.

---

## User-visible behavior

What the user or system experiences — behavior described from the outside in.

---

## Scope

## **In scope:**

## **Non-goals (explicitly out of scope):**

---

## Requirements

1. **<Requirement>** — Specific, testable behavior.
2. **<Requirement>** — Specific, testable behavior.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`)
- ***

## Design decisions

### Decision: <name>

**Chosen:**

## **Considered and rejected:**

---

## Acceptance criteria

<acceptance_criteria>

- [ ] Criterion — verifiable, specific
- [ ] `{{cmdValidateDeps}}` passes with zero violations

</acceptance_criteria>

---

## Implementation notes

Known tricky areas, suggested approach, relevant existing patterns.

---

## Test plan

- [ ] Manual step — what to do and what to observe
- [ ] Automated: what tests cover this

---

## Open questions

- [ ] **[CRITICAL]** Question that blocks implementation
- [ ] **[MINOR]** Question that can be resolved during implementation

---

## Tradeoffs and risks

What could go wrong. What the cost of being wrong is.
