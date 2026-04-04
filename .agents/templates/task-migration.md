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
|----------|----------|-----------|---------------------|
| | | | |

---

## Module checklist

One row per module. Update status as you go: `pending` / `in-progress` / `done`.

| Module | Status | Notes |
|--------|--------|-------|
| | pending | |

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `pnpm i` to install dependencies
- **Run `pnpm deps:validate` after every 10 files — mandatory**
- Document every shim contract in the table above before continuing past it

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
- [ ] Self-review complete (see Self-review section below)
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

**Completeness — the most important thing**
- Is every module in the checklist above marked `done`? If anything is `in-progress` or `pending`, this task is not complete.
- Search the codebase right now for imports pointing at the source location. Do not assume you got them all. Use grep. If you find any, fix them before proceeding.
- Are there empty directories or dead files left at the source location that should have been removed?

**Architecture**
- Run `pnpm deps:validate` right now. Not from a previous checkpoint — right now. Zero violations required.
- Does `pnpm typecheck` pass cleanly?
- Did you introduce any new violations while migrating? Moving code is not a license to restructure it.

**Shim contracts**
- Is every shim you added documented in the table with its old path, new path, known consumers, and the condition under which it can be removed?
- Are the shim targets correct — do they point to the new location?
- Is your Handoff unambiguous about which shims are still live and exactly what each consuming team needs to do?

**Blast radius**
- Did you touch files outside your team scope without documenting why? A migration that silently edits other teams' modules is a coordination failure.

Only when you can answer every one of these honestly should you write the Handoff.

## Handoff

### Done:

### Not done:

### Watch out for:

### Shims still live (consumers must update):

### Docs updated:
