# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: refactor
- Team: {{team}}

---

> ⚠️ **REFACTOR SESSION** — Run `pnpm deps:validate` after every 10 files. Do not declare done until it passes with zero violations. No codemods. No automated mutations. Every file change is individual and deliberate.

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific.

---

## Scope

{{teamScope}}

---

## Before state

Describe the current structure being changed. What does it look like now?

---

## After state

Describe the target structure. What will it look like when done?

---

## Shim contracts

Every public path you add a compatibility shim to. Do not remove a shim until all consumers are migrated.

| Shim path | Forwards to | Safe to remove when |
| --------- | ----------- | ------------------- |
|           |             |                     |

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `pnpm i` to install dependencies
- **Run `pnpm deps:validate` after every 10 files — mandatory, not optional**
- No codemods, no automated mutations, no shell loops over files
- Document every shim contract in the table above before continuing

---

## Progress checklist

- [ ] Fill in before state
- [ ] Fill in after state
- [ ] Identify all affected files
- [ ] Begin refactor
- [ ] `pnpm deps:validate` checkpoint 1
- [ ] `pnpm deps:validate` checkpoint 2
- [ ] `pnpm deps:validate` — final pass, zero violations
- [ ] `pnpm typecheck` passes
- [ ] All shim contracts documented
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

Before writing the Handoff, stop. Refactors are high-risk: they touch many files, they drift from intent, and they leave subtle breakage that only shows up later. Act as a senior engineer who did not write this refactor and is about to approve or reject it.

**Architecture — the non-negotiable**

- Run `pnpm deps:validate` right now. Not from memory. Not from a previous checkpoint. Right now. Zero violations required.
- Did you introduce any new architectural violations while cleaning up old ones? Cross-module internals, barrel files, wrong import paths?
- Does `pnpm typecheck` pass cleanly?

**Completeness**

- Is there anything still in the old location that should have moved? Search for the old paths explicitly — do not assume.
- Did you leave behind any empty directories, dead files, or orphaned imports pointing at nothing?
- Is every module in scope fully migrated, or did you stop partway through one?

**Shim contracts**

- Is every shim you added documented in the table above? Every single one.
- Are all shim targets correct — do they point to the new location, not the old one?
- Is it obvious from your Handoff which shims are still live and which consumers must act?

**Behaviour preservation**

- Did you change any behaviour while restructuring? Restructuring means moving and renaming, not rewriting. If you changed logic, justify it explicitly.
- Did you delete anything that is still needed somewhere?

**Scope**

- Did you touch files outside your team scope without documenting why?
- Did you make improvements or cleanups unrelated to the refactor? Revert them.

Only when you can answer every one of these honestly should you write the Handoff.

## Handoff

### Done:

### Not done:

### Watch out for:

### Shims still live (consumers must update):

### Docs updated:
