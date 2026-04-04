# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: feature
- Team: {{team}}

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific — vague objectives produce vague outcomes.

---

## Scope

{{teamScope}}

---

## Linked docs

- Spec: `{{specFile}}`

---

## Acceptance criteria

Derived from the spec. Each criterion is a checkbox — all must be checked before this task is done.

- [ ]
- [ ]

---

## Module plan

Which modules will be touched and what changes in each.

| Module | Change |
|--------|--------|
| | |

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `pnpm i` to install dependencies
- Run `pnpm deps:validate` and `pnpm typecheck` after every batch of changes

---

## Progress checklist

- [ ] Read spec in full
- [ ] Fill in acceptance criteria above
- [ ] Fill in module plan above
- [ ] Implement
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] `pnpm typecheck` passes
- [ ] Self-review complete (see Self-review section below)
- [ ] Handoff written

---

## Decisions

Key decisions made during this session and why.

- ***

## Findings

Codebase discoveries worth preserving. Move anything durable to an audit or spec.

- ***

## Assumptions

Things assumed to be true that were not explicitly confirmed. Mark each as `[pending]` or `[confirmed]`.

- [pending]

---

## Blockers

Anything preventing progress. What is needed to unblock.

- ***

## Next steps

Concrete starting points for the next session if this one ends incomplete.

- ***

## Self-review

Before writing the Handoff, stop. Act as a senior engineer doing an adversarial review of this implementation — someone who is looking for a reason to reject it. Read every diff as if you didn't write it. Be the critic.

**Correctness**
- Does the implementation satisfy every acceptance criterion exactly as stated in the spec? Not approximately — exactly. Go through them one by one.
- Is there anything in the spec you haven't addressed? Search the spec for requirements you might have skimmed.

**Architecture**
- Run `pnpm deps:validate` right now. Do not rely on a previous run. Zero violations required.
- Did you introduce any cross-module imports that go through internals (`models/`, `repositories/`, `engine/`, `presentations/components/`, `presentations/hooks/`)? Those are forbidden.
- Did you create any barrel files (`index.ts`) or pseudo-barrel re-exports? Remove them.

**React and TypeScript conventions**
- Did you use `useMemo`, `useCallback`, or `React.memo`? The compiler handles this — remove them.
- Did you use `&&` for conditional rendering? Use ternaries or early returns.
- Did you use `interface` instead of `type`? Did you use `enum` instead of `as const`?
- Does `pnpm typecheck` pass cleanly with zero errors?

**Scope**
- Did you touch files outside your team scope without a documented reason in Findings?
- Did you make any "while I'm here" improvements that weren't asked for? If yes, revert them — they don't belong in this branch.

**Completeness**
- Is anything left stubbed, TODO'd, or half-implemented?
- Would the next developer be able to pick this up with zero questions from your Handoff alone?

Only when you can answer every one of these honestly should you write the Handoff.

## Handoff

Summary for the next session or reviewer.

### Done:

### Not done:

### Watch out for:

### Docs updated:
