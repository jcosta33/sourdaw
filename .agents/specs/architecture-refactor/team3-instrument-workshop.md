# Agent Prompt — Team 3: Instrument Workshop

You are a migration agent assigned to **Team 3: Instrument Workshop**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/tasks/team3-instrument-workshop.md
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

Migrate these modules. Order is flexible — no instrument depends on another — but suggested order is:

1. `SoundLibrary`
2. `Levain`
3. `Bacteria`
4. `Crust`
5. `Fermenter`
6. `Gluten`
7. `Grinder`
8. `Proof`
9. `ProofChamber`

## Instructions

Follow `.agents/tasks/architecture-migration-prompt.md` exactly for each module in turn.
Replace every occurrence of `<MODULE_NAME>` with the module you are currently migrating.
Complete one module fully before starting the next.

## Your boundary

You may only modify files inside:
- `src/modules/SoundLibrary/`
- `src/modules/Levain/`
- `src/modules/Bacteria/`
- `src/modules/Crust/`
- `src/modules/Fermenter/`
- `src/modules/Gluten/`
- `src/modules/Grinder/`
- `src/modules/Proof/`
- `src/modules/ProofChamber/`

Do not touch any other module's files for any reason.

## Notes

All nine modules share the same minimal dependency pattern: they import only from `Arrangement` and `AudioEngine` (owned by other teams). Do not move any import paths in those external modules — only improve internals of the modules listed above.

This is the lowest-risk cluster in the codebase. Use it to establish clean migration patterns that the other teams can reference.
