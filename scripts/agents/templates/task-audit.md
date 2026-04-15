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

---

> 🔒 **READ-ONLY SESSION** — You may NOT modify any source files, configuration files, or dependencies. Your only output is an audit document. If you find something that needs fixing, note it in the audit — do not fix it here.

---

## Objective

What area to audit and what question to answer. One paragraph maximum.

---

## Linked docs

- Spec: `{{specFile}}`

---

## Audit output

Write your findings to: `.agents/audits/{{slug}}.md`
Use the audit template at `scripts/agents/templates/audit.md`.
Load `.agents/skills/write-audit/SKILL.md` before starting.

---

## Constraints

- **Read only — no source file modifications of any kind**
- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- **Do not read other specs, research, or bug reports** beyond the linked doc(s) provided to you. If context from another spec/research/bug file is needed, ask the user — do not browse `.agents/specs/`, `.agents/research/`, or `.agents/bugs/` on your own. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are fair game.

---

## Investigation checklist

- [ ] Load `.agents/skills/write-audit/SKILL.md`
- [ ] Read all files the audit covers
- [ ] Identify structural issues
- [ ] Identify repeated patterns or inconsistencies
- [ ] Identify performance concerns
- [ ] Identify correctness or safety concerns
- [ ] Write audit document at `.agents/audits/{{slug}}.md`
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Read-only constraint answered
- [ ] Self-review: Coverage answered
- [ ] Self-review: Evidence quality answered
- [ ] Self-review: Severity calibration answered
- [ ] Self-review: Recommendations answered

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

Stop. An audit that is incomplete, inaccurate, or contaminated by code changes is worse than no audit — it creates false confidence. Act as a senior engineer reviewing this audit document before it is published.

> **Hard gate.** The task is not complete until every question below has a written answer directly beneath it. An unanswered question is a skipped check. Incomplete Self-review is an invalid session output. If you cannot point to a specific file/line for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →

### The read-only constraint — check this first

- Any modified files in `git status` above? A read-only session that modified code is invalid — revert immediately.
  Answer:

### Coverage

- Does the audit cover every area it promised to cover, line by line? Anything skipped because it was hard/large/unclear must be flagged explicitly as "not covered" with a reason. Did you read actual code, or skim file names?
  Answer:

### Evidence quality

- Is every finding backed by a specific file path and (where applicable) line number or code excerpt? Could a developer locate every issue without more context from you?
  Answer:

### Severity calibration

- Are critical findings actually critical? Are minor findings actually minor? Anything filed as Minor/Observation that belongs in Critical/Major?
  Answer:

### Recommendations

- Is every recommendation specific and actionable (specific file, specific change) rather than a vibe ("improve X")?
  Answer:

Only when every answer above is written is this task complete.
