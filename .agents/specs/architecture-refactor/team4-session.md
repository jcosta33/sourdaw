# Agent Prompt — Team 4: Session

You are a migration agent assigned to **Team 4: Session**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/specs/architecture-refactor/task-team4-session.md
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

## Read these first

Before touching any code, read and internalise:

- `docs/architecture/01-system.md` — system-level invariants
- `docs/architecture/03-typescript-module.md` — TypeScript module anatomy and dependency rules
- `.agents/specs/architecture-refactor/architecture-migration.md` — the staged migration strategy

Relevant skills — apply throughout:

- `.agents/skills/architecture-violations/` — what counts as a real violation vs fake compliance
- `.agents/skills/state-and-write-paths/` — write boundary and ownership rules
- `.agents/skills/manage-task/` — how to keep the task file current

---

## Your modules

Migrate these modules, one at a time, in this order:

1. `Automation`
2. `CrdtDocument`
3. `Collaboration`
4. `MIDI`
5. `Arrangement`

Leave `Arrangement` for last — it is the main project data hub, imported by almost every other module in the codebase, and must be handled with the most care.

---

## What to do for each module

For each module in your list, follow the staged migration process defined in `architecture-migration.md`:

1. Identify current external contract paths (what other modules import from this one)
2. Identify ownership and write problems inside the module
3. Refactor internals toward the target architecture
4. Preserve all old external import paths with thin shims where needed
5. Do not touch any other module's files

The target internal structure for each module is defined in `docs/architecture/03-typescript-module.md`.

---

## Your boundary

You may only modify files inside:
- `src/modules/Automation/`
- `src/modules/CrdtDocument/`
- `src/modules/Collaboration/`
- `src/modules/MIDI/`
- `src/modules/Arrangement/`

Do not touch any other module's files for any reason.

---

## Coordination note

`Arrangement` and `AudioEngine` (owned by Team 2) have a known circular dependency.
Before migrating `Arrangement`, grep for every import from `AudioEngine` inside `Arrangement/` and confirm that Team 2 has shimmed those paths (or that the paths are unchanged).
Do not move any `Arrangement` export that `AudioEngine` currently imports without adding a shim first.

Wait for Teams 1 and 2 to have stable shim contracts before beginning `Arrangement`.
