# Agent Prompt — Team 6: Platform

You are a migration agent assigned to **Team 6: Platform**.

## Task file — required before any work begins

Before writing a single line of code, create a task file at:

```
.agents/specs/architecture-refactor/task-team6-platform.md
```

This file is your live working document for the entire migration. It must exist and be kept up to date throughout. Without it, this work cannot proceed.

Use it to track:
- **Status** — current area being migrated, overall progress
- **Area checklist** — one entry per area below, marked pending / in-progress / done
- **Findings** — architectural issues discovered (shadow architecture in helpers, business logic in components, broken DI boundaries, etc.)
- **Shim contracts** — every moved public path that is shimmed, so module teams can verify stability
- **Open questions** — anything uncertain that may need input from module teams or human review
- **Notes** — anything else relevant to continuity if the agent is interrupted and resumed

Update this file after completing each area and whenever you make a significant finding.

---

## Read these first

Before touching any code, read and internalise:

- `docs/architecture/01-system.md` — system-level invariants
- `docs/architecture/03-typescript-module.md` — TypeScript module anatomy, especially the anti-pattern: `src/helpers` absorbing module-specific logic
- `.agents/specs/architecture-refactor/architecture-migration.md` — the staged migration strategy

Relevant skills — apply throughout:

- `.agents/skills/architecture-violations/` — what counts as a real violation vs fake compliance
- `.agents/skills/state-and-write-paths/` — write boundary and ownership rules
- `.agents/skills/ui-patterns/` — presentation layer conventions for the design system
- `.agents/skills/tauri-platform/` — Tauri bridge rules (relevant for `tauriBridge.ts` and `platformCapabilities.ts`)
- `.agents/skills/manage-task/` — how to keep the task file current

---

## Your scope

You own the TypeScript infrastructure that all modules depend on. This is not a feature module — it is the platform layer the rest of the codebase is built on.

Your areas, in suggested order:

1. `src/helpers/` — shared infrastructure (Store, DI, Event, Logger, tauriBridge, platformCapabilities, etc.)
2. `src/components/ui/` — base UI primitives (Radix/shadcn)
3. `src/components/daw/` — DAW design system (~50 components)
4. `src/app/` — bootstrap, entry point, router, queryClient, Sentry init
5. `src/routes/` — TanStack Router route files
6. `src/styles/` — global CSS

---

## Your boundary

You may only modify files inside:
- `src/helpers/`
- `src/components/`
- `src/app/`
- `src/routes/`
- `src/styles/`

Do not touch anything inside `src/modules/`. Do not modify Rust/Tauri code.

---

## What to look for and fix

### `src/helpers/`

The architecture explicitly flags this as an anti-pattern risk:

> `src/helpers` absorbs module-specific logic → shadow architecture

Your job:
- Audit every helper for module-specific logic that leaked here from a module — flag it for the owning module's team
- Ensure `Store/` is a clean, thin base — not a write API
- Ensure `DependencyInjector/` (`Container.ts`) has a minimal, well-typed public API
- Ensure `Event/` is a clean generic mechanism with no domain knowledge baked in
- Ensure `tauriBridge.ts` is a proper typed port — all `invoke` usage behind stable typed function signatures
- Ensure `platformCapabilities.ts` is the single place for platform feature detection
- Ensure Logger, Math, Styles, UI helpers are genuinely generic and free of domain assumptions

### `src/components/daw/`

The DAW design system should be:
- Presentation-only — no business logic, no store writes, no use-case calls
- React 19 conventions throughout (no `forwardRef`, no manual memoization, no `useEffect` for state)
- Each component does one visual job

### `src/components/ui/`

Base Radix/shadcn primitives. Bring any customisations in line with React 19 conventions. Keep free of DAW-specific concerns.

### `src/app/`

Bootstrap and initialisation. Look for:
- Business logic buried in `bootstrap.ts` that belongs in a module's use case or repository
- Incorrect initialisation order (RT-sensitive subsystems initialised too late or too early)

### `src/routes/`

Route files should be thin. Look for business logic inside route components and move it to the appropriate module's presentation layer.

---

## Shim rule

If you move any file in `src/helpers/` or `src/components/` that is imported by modules, preserve the old import path with a thin re-export shim. Module teams are not rewriting their imports during this migration pass.

---

## Coordination note

Module teams (Teams 1–5) import from `src/helpers/` and `src/components/daw/`. Any path you move without shimming will break their branches.

Preferred: run Team 6 after Teams 1–5 have stabilised, so you can see exactly which paths are still in active use. If running in parallel, be conservative — shim everything you move.
