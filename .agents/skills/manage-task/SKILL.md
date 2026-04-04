---

name: manage-task
description: Load at the start of every session. Covers how to fill in, maintain, and close out the task file — what goes in each section, when to update it, and what a complete handoff looks like.

---

# SKILL: manage-task

## Purpose

The task file is the agent's working memory for a session. It records objective, plan, decisions, blockers, assumptions, and progress. A well-maintained task file means the session can be interrupted and resumed without loss. A poor one means context is reconstructed from scratch.

Template: `agents/templates/task.md`.
Task files are gitignored — they are local to the worktree and not shared.

---

## Core rules

1. **Fill in Objective before doing anything else.** One paragraph maximum. Specific. "Implement the gain computer for the limiter" is acceptable. "Work on audio stuff" is not.

2. **Write the Plan before writing code.** The plan is not a formality — it is how you confirm you understand the task before committing to an approach. Update it if the plan changes; it should reflect what you are actually doing.

3. **Track steps in the Progress checklist.** Mark steps complete as they happen. The checklist gives an at-a-glance view of what is done and what remains.

4. **Log decisions in the Decisions section.** Not just what you did — what you decided and why. "Chose to use the existing `useScheduler` hook rather than a new store because…" is useful. "Wrote some code" is not. This section exists separately from the checklist so decisions are easy to find.

5. **Record blockers immediately.** Do not work around a blocker silently. The moment something prevents confident or correct progress, record it in `## Blockers`. State what information or decision is needed to unblock.

6. **Mark assumptions as pending or confirmed.** Any assumption that turns out to be wrong must be corrected. An assumption that has been verified moves from `[pending]` to `[confirmed]`.

7. **Record findings as they emerge.** Discoveries about the codebase — surprising behavior, hidden dependencies, patterns — go in `## Findings`. If a finding belongs in a durable audit or spec, write it there too. Do not leave durable findings only in the task file.

8. **List docs loaded in Linked docs.** Every spec, audit, research file, or skill loaded during the session goes here. This is how the next session knows what context was available.

9. **Fill in Next steps before the Handoff.** If the session ends before the task is complete, `## Next steps` is where the incoming session finds its starting point. Be concrete: "Read `FermenterPanel.tsx:142` — that's where the allocation happens."

10. **Fill in Handoff before ending the session.** A session without a Handoff is incomplete. The next session must be able to start from the task file.

---

## Handoff requirements

A complete Handoff includes:

- **Done:** What was actually completed (not what was planned — what was done).
- **Not done:** What was planned but not completed, and why.
- **Watch out for:** Anything surprising, fragile, or likely to cause problems.
- **Docs updated:** Which audits, specs, or research files were touched during the session.

If the session was exploratory and produced no durable artifacts, record what was found and what the recommended next step is. An empty Handoff is never acceptable.

---

## Anti-patterns

- Writing the Objective after implementation — by then it is a description, not a goal.
- Leaving blockers unrecorded and working around them — the workaround becomes invisible debt.
- Leaving the Decisions section empty — significant choices made during the session will be invisible to the next.
- Not recording findings — if you discovered something useful about the codebase, it belongs somewhere permanent.
- Leaving durable findings only in the task file — task files are gitignored and local; write to audits or specs.
- Ending a session with an empty or placeholder Handoff.
- Not listing loaded docs in Linked docs — the next session cannot know what context was available.
