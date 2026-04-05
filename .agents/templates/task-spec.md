# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: spec
- Team: {{team}}

---

> 🔒 **SPEC WRITING SESSION** — This session produces a spec document, not code. You may NOT modify any source files, configuration files, or dependencies. Output: `.agents/specs/{{slug}}.md`.

---

## Objective

What spec to write and what decision or design it resolves. One paragraph maximum.

---

## Scope

{{teamScope}}

---

## Spec output

Write your spec to: `.agents/specs/{{slug}}.md`
Use the spec template at `.agents/templates/spec.md`.
Load `.agents/skills/write-spec/SKILL.md` before starting.

---

## Context

What problem this spec is solving. Who requested it. What drove the need.

---

## Research needed

What you need to understand before writing the spec. Mark each `[done]` when complete.

- [ ]

---

## Pattern survey

**Before drafting the spec, survey the codebase for existing implementations of similar concerns.** The goal is to reuse established patterns, shared helpers, and conventions rather than inventing parallel mechanisms. A spec that ignores prior art leads to fragmented architecture, duplicated logic, and integration friction downstream.

Look for:

- **Existing modules that solve adjacent problems.** Search `src/modules/` for features that overlap in domain, interaction shape, or data flow.
- **Shared helpers you can build on.** Check `src/helpers/` (Store, EventBus, inject, Logger, etc.) — prefer extending established primitives over creating new ones.
- **Architectural conventions.** Read `docs/architecture/` and `AGENTS.md` for patterns this spec must align with (layering, DI, event flow, state ownership).
- **Prior specs and audits.** `.agents/specs/` and `.agents/audits/` often contain decisions you should not relitigate.

Document what you found and how the spec integrates with it:

- **Similar implementations:** <file paths + one-line summary of how they solve the related problem>
- **Helpers / primitives to reuse:** <which ones, and why>
- **Conventions to follow:** <layering, naming, DI, event patterns, store contracts>
- **Deliberate departures:** <cases where this spec intentionally diverges from existing patterns, and the justification>

If you cannot find any prior art, state that explicitly — "no existing pattern found, this is net-new" is a valid finding, but it must be the result of a deliberate search, not an assumption.

---

## Constraints

- **No source file changes — spec document only**
- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- **Do not read other specs or research documents** beyond any linked doc provided to you. If context from another spec/research file is needed, ask the user — do not browse `.agents/specs/` or `.agents/research/` on your own. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are fair game.

---

## Progress checklist

- [ ] Load `.agents/skills/write-spec/SKILL.md`
- [ ] Review related specs in `.agents/specs/`
- [ ] Review related audits in `.agents/audits/`
- [ ] Complete all research items above
- [ ] **Complete Pattern survey** — document existing similar implementations, reusable helpers, and conventions this spec must align with
- [ ] Draft spec outline
- [ ] Fill in requirements and acceptance criteria
- [ ] Review for completeness and correctness
- [ ] Write spec at `.agents/specs/{{slug}}.md`
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Read-only constraint answered
- [ ] Self-review: Completeness answered
- [ ] Self-review: Scope and boundaries answered
- [ ] Self-review: Open questions answered
- [ ] Self-review: Consistency answered
- [ ] Self-review: Integration with existing patterns answered
- [ ] Handoff written

---

## Decisions

- ***

## Findings

Discoveries during research worth preserving beyond this spec.

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

Before writing the Handoff, stop. A spec that ships with gaps, ambiguities, or unresolved questions will cause a developer to make incorrect assumptions during implementation — and those assumptions compound. Act as a senior engineer who is about to greenlight this spec for implementation and is looking for every reason not to.

> **Hard gate.** The Handoff stays empty until every question below has a written answer directly beneath it. An unanswered question is a skipped check. A Handoff written with unanswered Self-review questions is an invalid session output. If you cannot point to a specific requirement/section/file for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →

### The read-only constraint — check this first

- Any modified source/config/dependency files in `git status` above? A spec session produces one output: the spec document. Revert anything else immediately.
  Answer:

### Completeness

- Could a developer start implementation tomorrow with no follow-up questions, based solely on this spec? Does every requirement have a testable acceptance criterion? Is every edge case and failure mode addressed?
  Answer:

### Scope and boundaries

- Is the scope clearly bounded? Could a developer accidentally implement something adjacent but out-of-scope and believe they were following the spec? Does the spec inadvertently describe work that belongs to a different team or spec?
  Answer:

### Open questions

- Are all unresolved questions flagged explicitly for stakeholders? Is it clear who needs to answer each and by when?
  Answer:

### Consistency

- Are all terms used consistently throughout? Does this spec contradict, duplicate, or conflict with anything in existing specs in `.agents/specs/`?
  Answer:

### Integration with existing patterns

- Did you complete the Pattern survey above? For each major design choice, does it reuse an established helper/primitive/convention, or does it introduce a new one? If new, is the "Deliberate departures" justification defensible? Would a reviewer familiar with the codebase recognize the spec's shape immediately?
  Answer:

Only when every answer above is written should you write the Handoff.

## Handoff

> If any question in Self-review above is unanswered, stop and fill those in first. Do not write the Handoff before the Self-review is complete.

### Spec written at:

### Open questions for stakeholders:

### Follow-up work identified:

### Docs updated:
