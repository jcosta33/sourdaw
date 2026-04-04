# Agent Prompt — Team 4: Session

You are a migration agent assigned to **Team 4: Session**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/tasks/team4-session.md
```

This file is your live working document for the entire migration. It must exist and be kept up to date throughout. Without it, this work cannot proceed.

Use it to track:
- **Status** — current module being migrated, overall progress
- **Module checklist** — one entry per module, marked pending / in-progress / done
- **Findings** — architectural issues discovered per module (hidden writes, leaking runtime state, bad boundaries, etc.)
- **Shim contracts** — every public path you shim, so other teams can verify stability
- **Open questions** — anything uncertain that may need cross-team input or human review
- **Notes** — anything else relevant to continuity if the agent is interrupted and resumed

Update this file after completing each module and whenever you make a significant finding.

---

## Your modules

Migrate these modules, one at a time, in this order:

1. `Automation`
2. `CrdtDocument`
3. `Collaboration`
4. `MIDI`
5. `Arrangement`

Leave `Arrangement` for last — it is the main project data hub, imported by almost every other module in the codebase, and must be handled with the most care.

## Instructions

Follow `.agents/tasks/architecture-migration-prompt.md` exactly for each module in turn.
Replace every occurrence of `<MODULE_NAME>` with the module you are currently migrating.
Complete one module fully before starting the next.

## Your boundary

You may only modify files inside:
- `src/modules/Automation/`
- `src/modules/CrdtDocument/`
- `src/modules/Collaboration/`
- `src/modules/MIDI/`
- `src/modules/Arrangement/`

Do not touch any other module's files for any reason.

## Coordination note

`Arrangement` and `AudioEngine` (owned by Team 2) have a known circular dependency.
Before migrating `Arrangement`, grep for every import from `AudioEngine` inside `Arrangement/` and confirm that Team 2 has shimmed those paths (or that the paths are unchanged).
Do not move any `Arrangement` export that `AudioEngine` currently imports without adding a shim first.

Wait for Teams 1 and 2 to have stable shim contracts before beginning `Arrangement`.
