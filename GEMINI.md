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
5. Check `.agents/research/` for existing findings (you cannot create research — surface gaps as blockers)

Full workflow: `docs/agents/03-workflow.md`
File type definitions: `docs/agents/02-file-types.md`
Templates: `agents/templates/` (audit, spec, task)

## Your task file

Create `.agents/tasks/<slug>.md` at the start of your session using `agents/templates/task.md`:

- Fill in **Objective** before doing anything else
- Fill in **Linked docs** with any specs/audits/skills loaded
- Check off **Progress checklist** steps as you complete them
- Log **Decisions** and **Findings** as they emerge
- Fill in **Handoff** before ending the session — never leave it empty

## Hard rules

- `pnpm deps:validate` must pass with zero violations before any task is complete
- Cross-module imports are only allowed from `useCases/`, `events/`, `errors/`, `stores/`, and `presentations/views/`
- Module internals (`models/`, `repositories/`, `engine/`, `presentations/components/`) are strictly private
- No barrel files, no `index.ts` re-exports
- Audio thread: no allocation, no blocking, no mutex locks

## Artifact placement

| Type | Location |
|---|---|
| Audit | `.agents/audits/<name>.md` |
| Spec | `.agents/specs/<name>.md` |
| Research | `.agents/research/<name>.md` |
| Skill | `.agents/skills/<name>/SKILL.md` |
| Task | `.agents/tasks/<slug>.md` (gitignored) |
