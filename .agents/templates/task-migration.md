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
- Team: {{team}}

---

> ⚠️ **MIGRATION SESSION** — Run `pnpm deps:validate` after every 10 files. Document every shim contract before moving on. Do not remove a shim until all consumers have migrated and you have confirmed it in the Handoff.

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific.

---

## Scope

{{teamScope}}

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
- **Do not read other specs or research documents** beyond the linked doc above. If context from another spec/research file is needed, ask the user — do not browse `.agents/specs/` or `.agents/research/` on your own. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are fair game.

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
- [ ] Handoff written

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

Before writing the Handoff, stop. A partial migration is a ticking time bomb — it leaves the codebase in an inconsistent state that quietly breaks things downstream. Act as a senior engineer about to approve this migration for merge.

> **Hard gate.** The Handoff stays empty until every question below has a written answer directly beneath it. An unanswered question is a skipped check. A Handoff written with unanswered Self-review questions is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

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

- Every shim documented with old path, new path, known consumers, and removal condition? All shim targets correct? Is your Handoff unambiguous about which shims are still live?
  Answer:

### Blast radius

- Did you touch files outside your team scope without documenting why?
  Answer:

Only when every answer above is written should you write the Handoff.

## Handoff

> If any question in Self-review above is unanswered, stop and fill those in first. Do not write the Handoff before the Self-review is complete.


### Done:

### Not done:

### Watch out for:

### Shims still live (consumers must update):

### Docs updated:
