# <Feature name>

## Context

Why this feature exists. What problem it solves. What came before it or prompted it.
Reference any relevant research: `.agents/research/<topic>.md`

---

## Goal

One or two sentences. What will be true when this spec is fully implemented.

---

## User-visible behavior

What the user (or system) experiences. Describe behavior from the outside in — what changes,
what the user sees, what they can now do that they could not before. Avoid implementation
detail here.

---

## Scope

**In scope:**

- Item

**Non-goals (explicitly out of scope):**

- Item (and why, if not obvious)

---

## Requirements

1. **<Requirement name>** — Specific, testable behavior statement.
2. **<Requirement name>** — Specific, testable behavior statement.
3. **<Requirement name>** — ...

---

## Constraints

Architecture, performance, platform, or design constraints that must hold regardless of implementation approach.

- Must follow the domain-driven module architecture (`AGENTS.md`)
- Must not allocate on the audio thread (if audio-path code)
- ...

---

## Design decisions

Significant decisions made during spec-writing, and why alternatives were rejected.

### Decision: <name>

**Chosen:** ...

**Considered and rejected:**

- Option A — rejected because ...
- Option B — rejected because ...

---

## Acceptance criteria

- [ ] Criterion 1 — verifiable, specific
- [ ] Criterion 2 — verifiable, specific
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] ...

---

## Implementation notes

Guidance for the implementer. Known tricky areas, suggested approach, ordering constraints,
relevant patterns already in the codebase. Not prescriptive — the implementer owns the how.

---

## Test plan

How to verify this feature works end-to-end after implementation.

- [ ] Manual step 1 — what to do and what to observe
- [ ] Manual step 2 — ...
- [ ] Automated: describe what tests cover this (or what should be added under the relevant `__tests__/` folder per `docs/06-testing.md` §3)

---

## Open questions

Questions that must be resolved before or during implementation.
Do not begin implementation while critical items here are unanswered.

- [ ] **[CRITICAL]** Question that blocks implementation
- [ ] **[MINOR]** Question that can be resolved during implementation

---

## Tradeoffs and risks

What could go wrong. What the cost of being wrong is. What to watch out for during implementation.
