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
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Architecture answered
- [ ] Self-review: Completeness answered
- [ ] Self-review: Shim contracts answered
- [ ] Self-review: Behaviour preservation answered
- [ ] Self-review: Scope answered
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

> **Hard gate.** The Handoff stays empty until every question below has a written answer directly beneath it. An unanswered question is a skipped check. A Handoff written with unanswered Self-review questions is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `pnpm deps:validate` (last line):
- `pnpm typecheck` (last line):

### Architecture — the non-negotiable

- Zero `pnpm deps:validate` violations (see pasted output above)? Any new architectural violations introduced while cleaning up old ones — cross-module internals, barrel files, wrong import paths?
  Answer:

### Completeness

- Is there anything still in the old location that should have moved? (grep for the old paths — do not assume) Any empty directories, dead files, or orphaned imports? Every module in scope fully migrated?
  Answer:

### Shim contracts

- Every shim documented in the table? All shim targets point to the new location? Is it obvious from your Handoff which shims are still live and which consumers must act?
  Answer:

### Behaviour preservation

- Did you change any behaviour while restructuring? Restructuring means moving and renaming, not rewriting. Did you delete anything still needed somewhere?
  Answer:

### Scope

- Files outside your team scope touched without documenting why? Unrelated improvements or cleanups?
  Answer:

Only when every answer above is written should you write the Handoff.

## Handoff

> If any question in Self-review above is unanswered, stop and fill those in first. Do not write the Handoff before the Self-review is complete.


### Done:

### Not done:

### Watch out for:

### Shims still live (consumers must update):

### Docs updated:
