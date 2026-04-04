# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active

---

## Objective

What this session must accomplish. One paragraph maximum.
Be specific. Vague objectives produce vague outcomes.

---

## Linked docs

- Spec: `{{specFile}}`

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `pnpm i` to install modules
- Run `pnpm deps:validate` and `pnpm typecheck` after every change

---

## Plan

Step-by-step plan before implementation starts.
Update this if the plan changes.

1.
2.
3.

---

## Progress checklist

- [ ] Step or deliverable
- [ ] Step or deliverable
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

Things assumed to be true that were not explicitly confirmed.
Mark each as `[pending]` or `[confirmed]` as the session progresses.

- [pending]

---

## Blockers

Anything preventing progress. What is needed to unblock.

- ***

## Next steps

Concrete starting points for the next session if this one ends incomplete.

- ***

## Self-review

Before writing the Handoff, stop. Act as a nitpicky senior engineer reviewing your own work as if you didn't write it. You are looking for a reason to reject it. Read every change adversarially.

- **Correctness:** Does the implementation do exactly what was asked? Not approximately — exactly.
- **Architecture:** Run `pnpm deps:validate` right now. Zero violations required. Does `pnpm typecheck` pass?
- **Conventions:** No `useMemo`/`useCallback`/`React.memo`. No `&&` in JSX rendering. No `interface` — use `type`. No `enum` — use `as const`. No barrel files. No cross-module internal imports.
- **Scope:** Did you touch anything outside the stated scope? Did you make improvements that weren't asked for? Revert them.
- **Completeness:** Is anything left stubbed, TODO'd, or half-finished?
- **Handoff quality:** Would the next developer be able to continue from your Handoff with zero questions?

Only when you can answer every one of these honestly should you write the Handoff.

## Handoff

Summary for the next session or reviewer.

### Done:

### Not done:

### Watch out for:

### Docs updated:
