# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: audit
- Team: {{team}}

---

> 🔒 **READ-ONLY SESSION** — You may NOT modify any source files, configuration files, or dependencies. Your only output is an audit document. If you find something that needs fixing, note it in the audit — do not fix it here.

---

## Objective

What area to audit and what question to answer. One paragraph maximum.

---

## Scope

{{teamScope}}

---

## Audit output

Write your findings to: `.agents/audits/{{slug}}.md`
Use the audit template at `.agents/templates/audit.md`.
Load `.agents/skills/write-audit/SKILL.md` before starting.

---

## Constraints

- **Read only — no source file modifications of any kind**
- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed

---

## Investigation checklist

- [ ] Load `.agents/skills/write-audit/SKILL.md`
- [ ] Read all files in scope
- [ ] Identify structural issues
- [ ] Identify repeated patterns or inconsistencies
- [ ] Identify performance concerns
- [ ] Identify correctness or safety concerns
- [ ] Write audit document at `.agents/audits/{{slug}}.md`
- [ ] Self-review complete (see Self-review section below)
- [ ] Handoff written

---

## Findings log

Running notes — will be synthesised into the audit doc at the end.

### Critical

### Major

### Minor

### Observations

---

## Blockers

- ***

## Next steps

Concrete starting points for the next session if this one ends incomplete.

- ***

## Self-review

Before writing the Handoff, stop. An audit that is incomplete, inaccurate, or contaminated by code changes is worse than no audit — it creates false confidence. Act as a senior engineer reviewing this audit document before it is published.

**The read-only constraint — check this first**
- Run `git status` right now. Are there any modified files? If yes, identify them immediately. Revert any source file, config file, or dependency change before proceeding. An audit session that modified code is invalid.

**Coverage**
- Does your audit document cover every area defined in the scope above? Go through the scope line by line. Did you skip anything because it was hard to read, large, or unclear? That is not acceptable — flag it explicitly as "not covered" with a reason.
- Did you read the actual code, or did you skim file names and make assumptions?

**Evidence quality**
- Is every finding backed by a specific file path and, where applicable, a line number or code excerpt? "The module structure seems inconsistent" is not a finding. "Line 47 of `useCase/getFoo.ts` imports from `models/` directly, violating the no-cross-module-internals rule" is a finding.
- Would a developer reading this audit be able to locate every issue you found without any additional context from you?

**Severity calibration**
- Are your critical findings actually critical? Are your minor findings actually minor? Over-inflating severities destroys trust in the document. Under-reporting buries real problems.
- Did you miss anything in the Critical or Major categories that you filed as Minor or Observation to avoid conflict?

**Recommendations**
- Is every recommendation specific and actionable? "Improve error handling" is not actionable. "Add a `Result<T, AppError>` return type to `getUserById.ts` and handle the error at the call site in `CommandHandler.ts`" is.

Only when you can answer every one of these honestly should you write the Handoff.

## Handoff

### Audit document written at:

### Key findings:

### Recommended follow-up tasks:

### Docs updated:
