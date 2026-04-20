---
name: manage-task
description: Load at the start of every session. Covers how to fill in, maintain, and close out the task file — what goes in each section, when to update it, and how to complete Self-review so the task is self-contained.
---

# SKILL: manage-task

## Purpose

The task file is the agent's working memory for a session. It records objective, plan, decisions, blockers, assumptions, and progress. A well-maintained task file means the session can be interrupted and resumed without loss. A poor one means context is reconstructed from scratch.

Template: `scripts/agents/templates/task.md` (or `task-<type>.md`).
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

9. **Fill in `## Next steps` when work is incomplete.** If the session ends before the task is done, this section is where a follow-up session finds its starting point. Be concrete: "Read `FermenterPanel.tsx:142` — that's where the allocation happens."

10. **Complete `## Self-review` before ending the session.** Tasks do not use a separate **Handoff** section — the task file is self-contained. Completion requires every Self-review question answered (including verification outputs), per the task template. **Force Empirical Proof (Show, Don't Tell):** You must mistrust your own code until you can mathematically or behaviorally prove it works. Never declare a task done without pasting the *actual console output* of a successful test run, compilation, or linter check. Checkboxes alone do not count. Use **Decisions**, **Findings**, **Blockers**, and **Next steps** to capture what would otherwise be narrative for the next reader.

11. **Primary deliverable first; document extra work.** The Objective names what must ship. Fixes or improvements you make along the way (even outside the first path you imagined) are fine when they are correct — note them in **Findings** or **Decisions** so reviewers can follow the branch. Do not revert good work only because it was not in the original ask.

12. **Adversarial Analysis (The Skeptic Persona).** When you are assigned to review, audit, analyze, or troubleshoot *any* work (whether it is an existing codebase feature, a bug report, or another agent's code), you must adopt the persona of **The Skeptic**. Analysis should ALWAYS be adversarial. Assume the code is buggy, incomplete, and violates architectural boundaries. Run the tests, check the `deps:validate` output, and actively hunt for edge cases, race conditions, or unhandled failures. If you are implementing, write your task file knowing that The Skeptic will review it next; leave enough empirical traces so they can verify your work.

13. **The Final Polish (Self-Questioning).** Before you enter the review stage of any task, you must pause and explicitly ask yourself: *"What else could I do? How can I make this even better? How can I make it even more stable and bug-free?"* You do not need to second-guess every decision, but you must never leave the work without performing this final adversarial pass. Ensure you answer the `### Final Polish` question in your task template.

---

## Anti-patterns

- Writing the Objective after implementation — by then it is a description, not a goal.
- Leaving blockers unrecorded and working around them — the workaround becomes invisible debt.
- Leaving the Decisions section empty — significant choices made during the session will be invisible to the next.
- Not recording findings — if you discovered something useful about the codebase, it belongs somewhere permanent.
- Leaving durable findings only in the task file — task files are gitignored and local; write to audits or specs.
- Ending a session with incomplete Self-review (unanswered questions or missing verification outputs).
- Not listing loaded docs in Linked docs — the next session cannot know what context was available.
