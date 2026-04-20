---
name: write-spec
description: Load before creating or updating a spec file. Covers what a spec must contain, how to write verifiable acceptance criteria, when open questions block implementation, and what belongs in a spec vs an audit vs a task file.
---

# SKILL: write-spec

## Purpose

A spec is the contract between intent and code. It translates upstream developer research (or direct knowledge) into specific, verifiable requirements. An agent implementing from a spec should be able to verify completion without asking anyone.

Specs are the bridge between developer-supplied input (research, product decisions) and agent execution. If research exists for the area being specced, that research must be reflected in the spec's requirements and constraints.

Full definition and required sections: `docs/agents/02-file-types.md` → Spec section.
Template: `docs/agents/templates/01-spec-template.md`.

---

## Core rules

1. **Specs are forward-looking.** They describe what will be true after implementation — not what exists today (that is the audit) and not how implementation will proceed (that is the task file).

2. **Ground the spec before writing it.** A spec must be grounded in existing research (`.agents/research/`) or established codebase knowledge. If research exists for this area, read it before writing the spec — the spec's requirements must reflect those findings. Do not introduce requirements that contradict existing research or architecture without explicitly flagging the conflict.

3. **Survey existing patterns first — do not reinvent.** Before writing requirements, search the codebase for similar implementations, shared helpers, and established conventions. Specs must reuse what exists (`src/helpers/`, existing modules, documented patterns in `docs/architecture/`) rather than invent parallel mechanisms. For each major design choice, document whether it reuses an existing primitive or introduces a new one, and justify any departure. A spec that ignores prior art creates integration debt, duplicated logic, and architectural fragmentation. If no existing pattern fits, state that as a deliberate finding — not an assumption.

4. **Acceptance criteria must be verifiable.** Each criterion must be determinable as true or false — by a person, a test, or a tool. "Works correctly" is not verifiable. "`pnpm deps:validate` passes with zero violations" is.

5. **Critical open questions block implementation.** Mark unresolved questions `[CRITICAL]` if implementation cannot proceed without answering them. Do not start writing code while `[CRITICAL]` items are open. Unblock by asking, not by assuming.

6. **Halt on Ambiguity (No Hallucinated Requirements).** AI agents are prone to confidently inventing requirements when faced with vague instructions. If a requirement could be satisfied two different ways, or if the user's request lacks necessary detail, you MUST halt and ask for clarification. Do not guess. Tighten the spec until only one interpretation is mathematically or behaviorally plausible.

7. **Record design decisions.** When a significant choice is made during spec-writing, record what was considered and why alternatives were rejected. This prevents relitigating the same decision in implementation.

8. **Scope must be explicit.** "Out of scope" is as important as "in scope". If something is not listed as out of scope, an implementer may reasonably assume it is in scope.

---

## What does not belong in a spec

- Codebase current state → that belongs in an audit
- Implementation plans or step-by-step approaches → that belongs in the task file
- Research findings → those belong in `.agents/research/`
- Things that are "nice to have but not required" without being clearly labelled as such

---

## Acceptance criteria format

Write criteria as concrete, falsifiable statements:

**Bad:**

- "The UI is responsive"
- "The feature feels fast"
- "It handles errors gracefully"

**Good:**

- "The fader renders at the correct position for 0 dB, -6 dB, and -∞ dB"
- "Response time is under 50 ms for payloads up to 1 MB (measured in Chromium)"
- "`pnpm deps:validate` passes with zero violations after the migration"

If you cannot write a verifiable criterion, the requirement is not well-defined. Stop and clarify before continuing.

---

## Anti-patterns

- Writing acceptance criteria as "it works" or "looks good" — these are untestable.
- Leaving `[CRITICAL]` open questions and starting implementation anyway.
- Conflating requirements (what must be true) with implementation approach (how to get there).
- Writing a spec without checking `.agents/audits/` first — the audit tells you the current state you are spec'ing away from.
- Allowing scope creep during spec-writing — if something new surfaces, add it to `## Open questions` or start a new spec.
- Reinventing mechanisms that already exist — introducing a new pattern without surveying `src/helpers/`, existing modules, and `docs/architecture/` first. Parallel mechanisms fragment the architecture and create integration debt.
