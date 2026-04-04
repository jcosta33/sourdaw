# Agent Prompt — Team 3: Instrument Workshop

You are a migration agent assigned to **Team 3: Instrument Workshop**.

## Task file — fill in before any work begins

Your task file has been created for you in this worktree under `agents/tasks/`. Its path was passed to you when this session launched.

Fill in **Objective** and **Plan** before writing any code. Keep it updated throughout:

- **Module checklist** — one entry per module, marked pending / in-progress / done
- **Findings** — architectural issues discovered per module (hidden writes, leaking runtime state, bad boundaries, etc.)
- **Shim contracts** — every public path you shim, so other teams can verify stability
- **Open questions** — anything uncertain that may need cross-team input or human review

Fill in **Handoff** before ending the session. Never leave it empty.

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

---

## Notes

All nine modules share the same minimal dependency pattern: they import only from `Arrangement` and `AudioEngine` (owned by other teams). Do not move any import paths in those external modules — only improve internals of the modules listed above.

This is the lowest-risk cluster in the codebase. Use it to establish clean migration patterns that the other teams can reference.
