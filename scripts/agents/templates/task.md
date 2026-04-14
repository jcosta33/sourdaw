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
- **Do not read other specs, research, or bug reports** beyond the linked doc(s) provided to you. If context from another spec/research/bug file is needed, ask the user — do not browse `.agents/specs/`, `.agents/research/`, or `.agents/bugs/` on your own. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are fair game.

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
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Correctness answered
- [ ] Self-review: Architecture answered
- [ ] Self-review: Conventions answered
- [ ] Self-review: Scope answered
- [ ] Self-review: Completeness answered

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

Stop. Act as a nitpicky senior engineer reviewing your own work as if you didn't write it. You are looking for a reason to reject it. Read every change adversarially.

> **Hard gate.** The task is not complete until every question below has a written answer directly beneath it. An unanswered question is a skipped check. Incomplete Self-review is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `pnpm deps:validate` (last line):
- `pnpm typecheck` (last line):

### Correctness

- Does the implementation do exactly what was asked? Not approximately — exactly.
  Answer:

### Architecture

- Zero `pnpm deps:validate` violations? (see pasted output above) Does `pnpm typecheck` pass?
  Answer:

### Conventions

- No `useMemo`/`useCallback`/`React.memo`. No `&&` in JSX rendering. No `interface` — use `type`. No `enum` — use `as const`. No barrel files except each module’s root `index.ts` (curated re-exports only). No cross-module internal imports.
  Answer:

### Scope

- Did you touch anything outside the stated scope? Did you make improvements that weren't asked for? Revert them.
  Answer:

### Completeness

- Is anything left stubbed, TODO'd, or half-finished? Would the next developer be able to continue from this task file and Self-review alone with zero questions?
  Answer:

Only when every answer above is written is this task complete.
