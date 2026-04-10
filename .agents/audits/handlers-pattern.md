# Command handler registries (`handlers/`) — purpose and architecture fit

## Scope

`AppAction` handler maps (`trackHandlers`-style), their **non-contract** placement, **`createHandler` / `createHandlers`** (`#/helpers/createHandlers`), and **`get<Module>Handlers`** use cases for cross-module access (primarily Command).

## Goal

1. Handler maps are **private** to each module (`handlers/`); **not** on `index.ts`.
2. **`createHandler`** / **`createHandlers`** are mandatory for construction.
3. **Cross-module** access only via **`getArrangementHandlers`** (pattern: `get<Module>Handlers`) re-exported from `index.ts`.
4. Architecture docs and `AGENTS.md` describe this without bending “use case” rules.

## Relevant code paths

| Area                                   | Role                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#/helpers/createHandlers.ts`          | `createHandler`, `createHandlers` — functional helpers replacing ad-hoc `satisfies ActionHandler<…>`.                                                                          |
| `Command/useCases/commandQueries.ts`   | `ActionHandler`, `HandlerDescribeResult`, `AppAction`.                                                                                                                         |
| `Arrangement/useCases/getArrangementHandlers.ts` | **Contract** use case: merges Arrangement handler maps for `executeAppAction`.                                                                                         |
| `Arrangement/useCases/*Handlers.ts`      | Legacy location for handler maps (migrate to `handlers/`).                                                                                                                     |
| `Arrangement/useCases/stretchHandlers.ts` | Reference implementation using `createHandler` + `createHandlers`.                                                                                                        |
| `Command/useCases/executeAppAction.ts` | `...getArrangementHandlers()` in registry.                                                                                                                                     |
| `docs/architecture/03-typescript-module.md` §4.5 | Formal definition of handlers.                                                                                                                                          |
| `AGENTS.md`                            | Private `handlers/`, helpers, `get<Module>Handlers` rule.                                                                                                                      |

## Current behavior

1. **Typed actions** — `AppAction` union in `commandQueries.ts`.
2. **Dispatch** — `executeAppAction` merges `getArrangementHandlers()` with other modules’ handler sources.
3. **Helpers** — `createHandler<'muteTrack'>({ execute, describe, undoable })` builds each entry; `createHandlers({ ... })` wraps assembled records.
4. **Arrangement index** — exports **`getArrangementHandlers` only**; individual `trackHandlers`, `clipHandlers`, etc. are **no longer** public.
5. **Migration** — Remaining `*Handlers.ts` files should adopt `createHandler` / `createHandlers` and eventually move under **`handlers/`**.

## Findings

1. **Registry indirection remains load-bearing** — Command still needs a merged map per domain; **`get<Module>Handlers`** is the narrow contract.
2. **`handlers/` is enforced as private** — `module-index-contract` + `AGENTS.md` forbid `index.ts` importing `handlers/`; handler maps are not barrel exports.
3. **One function per file** applies to **`getArrangementHandlers.ts`** and to each granular use case; multi-export handler **maps** are confined to non-contract files.

## Priorities

1. Migrate remaining Arrangement `*Handlers.ts` entries to **`createHandler`** (remove `satisfies` noise).
2. Move handler files from `useCases/` to **`handlers/`** per module.
3. Add **`getTransportHandlers`**, **`getWorkspaceHandlers`**, etc., mirroring Arrangement; shrink direct handler exports from other module indexes the same way.

## Open issues

1. **Other modules** still export raw `*Handlers` from `index.ts`** (Transport, Workspace, …)** — align with **`get<Module>Handlers`** pattern.
2. **Tests** import `execute*` from relative `*Handlers` paths — still valid intra-module.

## Open questions

- Codegen for `handlerRegistry` keys vs `AppAction['type']` — optional hardening.

## Risks

- **Drift:** New handler entries added without `createHandler` — catch in review until lint rule exists.

## Suggested approaches

- Roll **`get<Module>Handlers`** + **`createHandler`** across modules.
- Optional ESLint: enforce imports of `createHandler` from handler files.

## Recommendation

**Done for Arrangement + docs + helpers.** Continue the same pattern module-by-module.

## Resolved

- **`HandlerDescribeResult`** exported from Command for helper typing.
- **`#/helpers/createHandlers`** added (`createHandler`, `createHandlers`).
- **`getArrangementHandlers`** is the sole Arrangement barrel export for handler maps; **`stretchHandlers`** refactored to use helpers.
- **`docs/architecture/03-typescript-module.md` §4.5** — handlers (non-contract), helpers, `get<Module>Handlers`.
- **`AGENTS.md`** — `handlers/` private, helpers, access rule.
- **`.dependency-cruiser.cjs`** — comment lists `handlers/` as forbidden from `index.ts` imports.
