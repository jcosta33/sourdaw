# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: migration

---

> ⚠️ **MIGRATION SESSION** — Run `pnpm deps:validate` after every 10 files. Document every shim contract before moving on. Do not remove a shim until all consumers have migrated and you have documented that confirmation in this task file (Decisions or Self-review).

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific.

---

## Linked docs

- Spec: `{{specFile}}`

---

## Source

Current location and structure being migrated from.

---

## Target

New location and structure being migrated to.

---

## Shim contracts

Every shim added to preserve backward compatibility while consumers migrate.

| Old path | New path | Consumers | Safe to remove when |
| -------- | -------- | --------- | ------------------- |
|          |          |           |                     |

---

## Module checklist

One row per module. Update status as you go: `pending` / `in-progress` / `done`.

| Module | Status  | Notes |
| ------ | ------- | ----- |
|        | pending |       |

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `pnpm i` to install dependencies
- **Run `pnpm deps:validate` after every 10 files — mandatory**
- Document every shim contract in the table above before continuing past it
- **Do not read other specs, research, or bug reports** beyond the linked doc(s) provided to you. If context from another spec/research/bug file is needed, ask the user — do not browse `.agents/specs/`, `.agents/research/`, or `.agents/bugs/` on your own. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are fair game.

---

## Progress checklist

- [ ] Fill in source and target
- [ ] List all modules in module checklist
- [ ] Begin migration
- [ ] `pnpm deps:validate` checkpoint 1
- [ ] `pnpm deps:validate` checkpoint 2
- [ ] All modules migrated
- [ ] All shim contracts documented
- [ ] `pnpm deps:validate` — final pass, zero violations
- [ ] `pnpm typecheck` passes
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Completeness answered
- [ ] Self-review: Architecture answered
- [ ] Self-review: Shim contracts answered
- [ ] Self-review: Blast radius answered

---

## Decisions

- ***

## Findings

- ***

## Assumptions

- [pending]

---

## Blockers

- ***

## Next steps

Concrete starting points for the next session if this one ends incomplete.

- ***

## Self-review

Stop. A partial migration is a ticking time bomb — it leaves the codebase in an inconsistent state that quietly breaks things downstream. Act as a senior engineer about to approve this migration for merge.

> **Hard gate.** The task is not complete until every question below has a written answer directly beneath it. An unanswered question is a skipped check. Incomplete Self-review is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `pnpm deps:validate` (last line):
- `pnpm typecheck` (last line):
- grep for old source paths (paste result or "none"):

### Completeness — the most important thing

- Every module in the checklist marked `done`? Did you grep for imports pointing at the old location (paste result above)? Any empty directories or dead files left at the source?
  Answer:

### Architecture

- Zero `pnpm deps:validate` violations (see pasted output above)? `pnpm typecheck` clean? Did you introduce any new violations while migrating? Moving code is not a license to restructure it.
  Answer:

### Shim contracts

- Every shim documented with old path, new path, known consumers, and removal condition? All shim targets correct? Is this task file unambiguous about which shims are still live?
  Answer:

### Blast radius

- Did you change files beyond what the migration plan listed? Note additions in **Findings** or **Decisions** so reviewers can trace the branch — not a reason to avoid necessary fixes.
  Answer:

Only when every answer above is written is this task complete.
