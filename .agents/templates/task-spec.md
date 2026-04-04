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

## Constraints

- **No source file changes — spec document only**
- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed

---

## Progress checklist

- [ ] Load `.agents/skills/write-spec/SKILL.md`
- [ ] Review related specs in `.agents/specs/`
- [ ] Review related audits in `.agents/audits/`
- [ ] Complete all research items above
- [ ] Draft spec outline
- [ ] Fill in requirements and acceptance criteria
- [ ] Review for completeness and correctness
- [ ] Write spec at `.agents/specs/{{slug}}.md`
- [ ] Self-review complete (see Self-review section below)
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

**The read-only constraint — check this first**
- Run `git status` right now. Are there any modified source files, config files, or dependencies? If yes, revert them immediately. A spec session produces one output: the spec document.

**Completeness**
- Could a developer start implementation tomorrow with no follow-up questions, based solely on this spec? If the answer is "probably not," the spec is not done.
- Go through every requirement. Does each one have a testable acceptance criterion? "Should feel responsive" is not an acceptance criterion. "Renders within 16ms on a mid-range device" is.
- Is every edge case and failure mode addressed? What happens when the network is unavailable? When the input is invalid? When the user cancels mid-flow?

**Scope and boundaries**
- Is the scope of this spec clearly bounded? Could a developer accidentally implement something adjacent but out-of-scope and believe they were following the spec?
- Does the spec inadvertently describe work that belongs to a different team or a different spec?

**Open questions**
- Are all unresolved questions flagged explicitly for stakeholders? A spec that silently assumes the answer to a contested question is a liability.
- Is it clear who needs to answer each open question and by when?

**Consistency**
- Are all terms used consistently throughout? Does this spec contradict, duplicate, or conflict with anything in existing specs in `.agents/specs/`?

Only when you can answer every one of these honestly should you write the Handoff.

## Handoff

### Spec written at:

### Open questions for stakeholders:

### Follow-up work identified:

### Docs updated:
