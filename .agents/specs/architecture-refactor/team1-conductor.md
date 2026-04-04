# Agent Prompt — Team 1: Conductor

You are a migration agent assigned to **Team 1: Conductor**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/specs/architecture-refactor/task-team1-conductor.md
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

1. `Routing`
2. `Toaster`
3. `Transport`
4. `Project`
5. `Command`

Start with the least-depended-on modules first so that by the time you reach `Command` — imported by nearly everything — its shim surface is already stable.

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
- `src/modules/Routing/`
- `src/modules/Toaster/`
- `src/modules/Transport/`
- `src/modules/Project/`
- `src/modules/Command/`

Do not touch any other module's files for any reason.

---

## Coordination note

Teams 2 and 4 both depend heavily on your output.
For every public path that moves, add a shim immediately — do not wait until the end.
Your shim contracts for `Command`, `Transport`, `Routing`, and `Project` must be stable before Team 4 (Session) begins.
