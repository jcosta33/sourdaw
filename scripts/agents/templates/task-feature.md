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

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific — vague objectives produce vague outcomes.

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
| ------ | ------ |
|        |        |

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `pnpm i` to install dependencies
- Run `pnpm deps:validate` and `pnpm typecheck` after every batch of changes
- **Proactively research and read related docs.** If context from another spec, research, or bug file is needed, you are empowered to browse `.agents/specs/`, `.agents/research/`, or `.agents/bugs/` on your own to confirm your hypotheses and make informed decisions. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are also fair game.

---

## Progress checklist

- [ ] Read spec in full
- [ ] Fill in acceptance criteria above
- [ ] Fill in module plan above
- [ ] Implement
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] `pnpm typecheck` passes
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Correctness answered
- [ ] Self-review: Architecture answered
- [ ] Self-review: React and TypeScript conventions answered
- [ ] Self-review: Primary deliverable and related work answered
- [ ] Self-review: Completeness answered

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

Stop. Act as a senior engineer doing an adversarial review of this implementation — someone who is looking for a reason to reject it. Read every diff as if you didn't write it. Be the critic.

> **Hard gate.** The task is not complete until every question below has a written answer directly beneath it. An unanswered question is a skipped check. Incomplete Self-review is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `pnpm deps:validate` (last line):
- `pnpm typecheck` (last line):

### Correctness

- Does the implementation satisfy every acceptance criterion exactly as stated in the spec? Not approximately — exactly. Go through them one by one. Is there anything in the spec you haven't addressed?
  Answer:

### Architecture

- Zero `pnpm deps:validate` violations (see pasted output above)? Did you introduce any cross-module imports through internals (`models/`, `repositories/`, `engine/`, `presentations/components/`, `presentations/hooks/`)? Any barrel files other than a module root `index.ts` (or pseudo-barrels like `contracts.ts`)?
  Answer:

### React and TypeScript conventions

- Did you use `useMemo`, `useCallback`, or `React.memo`? Did you use `&&` for conditional rendering? Did you use `interface` instead of `type`, or `enum` instead of `as const`? Does `pnpm typecheck` pass cleanly?
  Answer:

### Primary deliverable and related work

- The **Objective** and spec are what you must ship. If you fixed or improved something outside that path, note it in **Findings** or **Decisions**. Do not revert correct work only because it was not in the original ask.
  Answer:

### Completeness

- Is anything left stubbed, TODO'd, or half-implemented? Would the next developer be able to pick this up with zero questions from this task file and Self-review alone?
  Answer:

Only when every answer above is written is this task complete.
