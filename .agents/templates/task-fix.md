# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: fix
- Team: {{team}}

---

> ⚠️ **FIX SESSION — MINIMAL BLAST RADIUS** — Touch only the files necessary to resolve the issue. Do not refactor surrounding code. Do not make "while I'm here" improvements. If you find related issues, note them in Findings — do not fix them.

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific.

---

## Scope

{{teamScope}}

---

## Bug description

What is wrong. Observable symptoms.

---

## Reproduction steps

1.

---

## Root cause

[pending — fill in once found]

---

## Expected fix scope

List the specific files you expect to modify. If you find yourself touching more than this, stop and note it as a finding.

-

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `pnpm i` to install dependencies
- Run `pnpm deps:validate` and `pnpm typecheck` after fixing
- **Minimum necessary changes only** — no refactoring, no cleanup, no improvements

---

## Progress checklist

- [ ] Reproduce the bug
- [ ] Identify root cause
- [ ] Fill in root cause above
- [ ] Implement fix
- [ ] Verify fix resolves the issue
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] `pnpm typecheck` passes
- [ ] Self-review complete (see Self-review section below)
- [ ] Handoff written

---

## Decisions

- ***

## Findings

Related issues found during investigation — do not fix these, just note them.

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

Before writing the Handoff, stop. The standard for a fix is brutal simplicity: the minimum change that addresses the root cause, nothing more. Act as a senior engineer reviewing this diff with maximum skepticism. You are looking for anything that shouldn't be there.

**Root cause**
- Does the fix address the root cause, or just the symptom? If the bug were triggered in a slightly different way, would it reappear?
- Is the root cause documented accurately in the field above? A vague root cause is a sign the fix is also vague.

**Minimality — the hardest part**
- Count the files you changed. Could you fix this bug by touching fewer files? If yes, do it.
- Read every line you changed. Is every single line necessary to fix the bug? Anything that isn't — revert it. Cleanup, refactoring, and improvements do not belong in a fix branch.
- Did you change any behaviour beyond what was broken? Any change you cannot directly trace to the bug report is scope creep. Remove it.

**Correctness**
- Run `pnpm deps:validate`. Zero violations.
- Does `pnpm typecheck` pass?
- Could this fix introduce a regression in any code path that depends on what you changed? Search for callers.

**Conventions**
- Did you accidentally violate any React 19 rules, architectural boundaries, or coding conventions while fixing the bug? A fix is no excuse for a new violation.

Only when you can answer every one of these honestly should you write the Handoff.

## Handoff

### Done:

### Not done:

### Watch out for:

### Docs updated:
