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

- ***

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
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Root cause answered
- [ ] Self-review: Minimality answered
- [ ] Self-review: Correctness answered
- [ ] Self-review: Conventions answered
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

> **Hard gate.** The Handoff stays empty until every question below has a written answer directly beneath it. An unanswered question is a skipped check. A Handoff written with unanswered Self-review questions is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `git diff --stat` →
- `pnpm deps:validate` (last line):
- `pnpm typecheck` (last line):

### Root cause

- Does the fix address the root cause, or just the symptom? If the bug were triggered in a slightly different way, would it reappear? Is the root cause documented accurately above?
  Answer:

### Minimality — the hardest part

- Could you fix this bug by touching fewer files? Is every single line necessary to fix the bug? Anything traceable to "cleanup" or "while I'm here" — revert it.
  Answer:

### Correctness

- Zero `pnpm deps:validate` violations? `pnpm typecheck` clean? Could this fix introduce a regression in any code path that depends on what you changed? Did you grep for callers?
  Answer:

### Conventions

- Did you accidentally violate any React 19 rules, architectural boundaries, or coding conventions while fixing the bug?
  Answer:

Only when every answer above is written should you write the Handoff.

## Handoff

> If any question in Self-review above is unanswered, stop and fill those in first. Do not write the Handoff before the Self-review is complete.

### Done:

### Not done:

### Watch out for:

### Docs updated:
