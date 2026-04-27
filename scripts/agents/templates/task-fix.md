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

---

> **FIX SESSION** — Prefer the smallest change that fixes the bug. If you discover a related defect or an obvious safety fix in the same area, you may take it on; document it in **Findings** or **Decisions**. Do not revert correct fixes only to keep the diff smaller.
>
> **PERSONA:** Load `.agents/skills/personas/SKILL.md` and adopt **The Skeptic** persona.

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific.

---

## Linked docs

- Bug: `{{specFile}}`

---

## Bug description

<bug_description>

What is wrong. Observable symptoms.

</bug_description>

---

## Reproduction steps

<reproduction_steps>

1.

</reproduction_steps>

---

## Root cause

<root_cause>

[pending — fill in once found]

</root_cause>

---

## Expected files to touch

List the files you expect to change. If investigation requires more, extend the list and note why in **Findings** or **Decisions**.

- ***

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `{{cmdInstall}}` to install dependencies
- Run `pnpm agents:validate` after fixing
- Prefer **minimal** fixes for the reported bug; opportunistic fixes elsewhere should be small, clearly correct, and documented
- **Proactively research and read related docs.** If context from another spec, research, or bug file is needed, you are empowered to browse `.agents/specs/`, `.agents/research/`, or `.agents/bugs/` on your own to confirm your hypotheses and make informed decisions. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are also fair game.

---

## Progress checklist

- [ ] Reproduce the bug
- [ ] Identify root cause
- [ ] Fill in root cause above
- [ ] Implement fix
- [ ] Verify fix resolves the issue
- [ ] `pnpm agents:validate` passes
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Root cause answered
- [ ] Self-review: Minimality answered
- [ ] Self-review: Correctness answered
- [ ] Self-review: Conventions answered

---

## Decisions

- ***

## Findings

Related issues found during investigation — note them here. Fix if they block the bug or are clearly safe; otherwise leave for a follow-up and say so.

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

<self_review>

Stop. The standard for a fix is brutal simplicity: the minimum change that addresses the root cause, nothing more. Act as a senior engineer reviewing this diff with maximum skepticism. You are looking for anything that shouldn't be there.

> **Hard gate.** The task is not complete until every question below has a written answer directly beneath it. An unanswered question is a skipped check. Incomplete Self-review is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `git diff --stat` →
- `pnpm agents:validate` (last 2 lines):

### Root cause

- Does the fix address the root cause, or just the symptom? If the bug were triggered in a slightly different way, would it reappear? Is the root cause documented accurately above?
  Answer:

### Minimality — the hardest part

- Could you fix this bug by touching fewer files? Is every single line necessary to fix the bug? If you included extra fixes, are they justified in **Findings** or **Decisions**? Revert only what is wrong or risky — not correct work you only meant to trim from the diff.
  Answer:

### Correctness

- Zero validation errors? `{{cmdTypecheck}}` clean? Could this fix introduce a regression in any code path that depends on what you changed? Did you grep for callers?
  Answer:

### Conventions

- Did you accidentally violate any React 19 rules, architectural boundaries, or coding conventions while fixing the bug?
  Answer:

### Final Polish

- Did you ask yourself: "What else could I do? How can I make this even better, more stable, or more bug-free?" Do not second-guess every decision, but do not leave the work without this final adversarial pass.
  Answer:

Only when every answer above is written is this task complete.

</self_review>
