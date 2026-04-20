---
name: write-audit
description: Load before creating or updating an audit file. Covers what an audit must contain, how to distinguish findings from current state, what makes an issue actionable, and when to create vs update.
---

# SKILL: write-audit

## Purpose

Audits are honest reports on the current state of a codebase area relative to a goal. A good audit makes the next session's job clear without requiring that session to re-examine the same ground.

Full definition and required sections: `docs/agents/02-file-types.md` → Audit section.
Template: `docs/agents/templates/audit.template.md`.

---

## Core rules

1. **Start with the goal.** The `## Goal` section defines what "good" looks like. Without it, "current state" has no meaning — there is no baseline to measure against.

2. **Current state describes reality, not aspiration.** Write what exists today, with file and line references. Do not describe planned changes or what you wish were true.

3. **Findings are observations, not issues.** `## Findings` captures patterns and structural insights that are not obvious from reading individual files. Issues are specific, numbered, and actionable. Do not conflate them.

4. **Adversarial Analysis (The Skeptic Persona).** When writing or updating an audit, your analysis must ALWAYS be adversarial. Do not trust that existing code works as intended. Actively hunt for architectural violations, edge cases, race conditions, and unhandled failures. Assume the codebase is trying to hide its flaws from you.

5. **Every open issue must have a "Needed".** An issue without a concrete resolution path is not an issue — it is a complaint. Each issue must state what concrete change would close it.

5. **Prioritise issues explicitly.** The `## Priorities` section should list issues in order of impact so the next session has a starting point, not a flat list.

6. **Risks belong in the audit.** If leaving issues unaddressed carries real risk — correctness, performance, maintainability — state it. Do not leave this implicit.

7. **Suggested approaches are not specs.** They provide direction and rationale. The spec is where implementation decisions are made. Keep suggested approaches high-level.

8. **Mark resolved issues.** The `## Resolved` section exists so future sessions do not re-investigate the same ground. Use it.

---

## Create vs update

**Update** an existing audit if:

- It covers the same area and its issues are stale
- Implementation during this session resolved or changed issues it tracks
- New issues were discovered in an area already audited

**Create** a new audit if:

- No audit exists for this area
- The existing audit covers a different scope or goal
- The area has changed enough that updating would require rewriting most of it

Do not create a second audit for the same area. Consolidate.

---

## Anti-patterns

- Writing an audit after implementation to justify decisions already made — audits precede implementation, they do not narrate it.
- Listing issues without representative files — specificity is the entire point.
- Leaving `## Risks` and `## Suggested approaches` empty — these are what make an audit actionable.
- Putting implementation plans in the audit — that belongs in the spec.
- Letting an audit go stale after changes land — mark resolved issues resolved.
