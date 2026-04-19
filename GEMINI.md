# Gemini CLI — Sourdaw

## Start here

Read `AGENTS.md` in full. It contains the canonical architectural rules, coding conventions, and documentation workflow for this repo. Everything in it applies to you.

## Documentation-first

Load `.agents/skills/documentation-gatekeeper/SKILL.md` at the start of every non-trivial session. It encodes the sequencing invariants for this workflow.

Before implementing anything non-trivial:

1. Load `.agents/skills/manage-task/SKILL.md` and create a task file at `.agents/tasks/<slug>.md`
2. Check `.agents/specs/` for an existing spec — load `.agents/skills/write-spec/SKILL.md` if writing one
3. Check `.agents/audits/` for an existing audit — load `.agents/skills/write-audit/SKILL.md` if writing one
4. Load domain skills from `.agents/skills/` — read the `description` field of each SKILL.md
5. Check `.agents/research/` for existing findings (you may proactively research and create new research files when needed to validate assumptions or technical approaches)

Full workflow: `docs/agents/03-workflow.md`
File type definitions: `docs/agents/02-file-types.md`
Templates: `scripts/agents/templates/` (audit, spec, task)

## Your task file

This only applies if you were launched via the agents workflow (worktree-based parallel sessions). In a regular session this directory will be empty and you can ignore this entirely.

If `.agents/tasks/` contains a file, that is your task file for this session. Read it before doing anything else — it contains your spec reference, objective, plan, and checklist.

- Fill in **Objective** before doing anything else
- Fill in **Linked docs** with any specs/audits/skills loaded
- Check off **Progress checklist** steps as you complete them
- Log **Decisions** and **Findings** as they emerge
- Complete **`## Self-review`** before ending the session (every question answered, verification outputs pasted). Task files have no separate Handoff section.

## Hard rules

- **Force Empirical Proof (Show, Don't Tell):** Mistrust your own code. Never declare a task complete without empirical verification. You must paste actual console output of tests, linters, or compilation to prove success.
- **Three Strikes Rule:** If you attempt to fix an error 3 times and fail, stop. Discard your approach, reread the spec, and formulate a fundamentally different strategy.
- **Blast Radius & Invariants:** Use `pnpm typecheck` to navigate the blast radius of your changes. Evaluate the holistic app state (errors, loading) and avoid "happy path only" coding.
- `pnpm deps:validate` must pass with zero violations before any task is complete
- Cross-module imports must target each module’s root `index.ts` only (no deep paths into `useCases/`, `stores/`, `presentations/views/`, etc.)
- Module internals (`models/`, `repositories/`, `engine/`, `presentations/components/`) are strictly private
- No barrel files except each module’s root `index.ts`, which may only re-export from `useCases/`, `events/`, `stores/`, and `presentations/views/` — do not `export type` from `useCases/` for other modules (`AGENTS.md`)
- Audio thread: no allocation, no blocking, no mutex locks
- **TypeScript soundness:** Follow `AGENTS.md` (React — **TypeScript — soundness**). No `any` or assertion escapes to silence errors, no lazy test assertions, no suppression comments without justification.

## Safety rules (bypass-permissions mode is active)

There are no confirmation prompts. Actions are immediate. Read the full safety section in `AGENTS.md` before doing anything. The short version:

- **Do not delete files** — ever, unless the instruction explicitly names the file to delete.
- **Do not run destructive git commands** — no `reset --hard`, `clean`, `push --force`, or anything that discards work.
- **Do not install or remove packages** without an explicit instruction to do so.
- **Do not modify `.github/`, CI config, or `package.json` scripts** unless that is the task.
- **Stay in your worktree.** Do not make changes in the main repo or other worktrees.
- **When in doubt, don't.** Log it as a finding and move on.

## Artifact placement

| Type     | Location                               |
| -------- | -------------------------------------- |
| Audit    | `.agents/audits/<name>.md`             |
| Spec     | `.agents/specs/<name>.md`              |
| Research | `.agents/research/<name>.md`           |
| Skill    | `.agents/skills/<name>/SKILL.md`       |
| Task     | `.agents/tasks/<slug>.md` (gitignored) |
