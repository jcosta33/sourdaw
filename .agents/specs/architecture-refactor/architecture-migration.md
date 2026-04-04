# Migration Architecture

This document defines how to migrate the codebase from the **original architecture** to the **new architecture** safely.

It is written for AI agents and maintainers working in a large, partially inconsistent codebase where:

- the original architecture had strong ideas but uneven enforcement
- the new architecture is clearer and more unified
- the migration will happen incrementally
- multiple agents may work in parallel
- module-by-module refactors must remain mergeable

This is a migration strategy document, not the target architecture itself.

It complements:

- `DAW System Architecture`
- `TypeScript Module Architecture`
- `Rust Backend Architecture`

---

## 1. Purpose

The migration exists to move the codebase from the original architecture to the new one without:

- destabilizing working behavior
- regressing real-time safety
- forcing large all-at-once rewrites
- breaking external imports during parallel migration
- creating a shadow architecture
- turning the migration into a folder-renaming exercise

The goal is:

```text
preserve behavior
while steadily improving ownership, boundaries, and runtime safety
```

---

## 2. What the original architecture already got right

The original architecture already established several important truths that remain correct and must be preserved during migration:

- the real-time boundary is inviolable
- the project store is the single source of truth
- domain models are plain types
- engine/runtime objects are stateful runtime resources
- business writes go through use cases
- repositories are the TypeScript I/O boundary
- renderers are presentation-layer I/O
- Tauri is a bridge, not the core
- the backend should keep domain logic out of `src-tauri`
- the Rust engine must preserve a hard RT vs non-RT boundary

Those ideas remain valid.
The migration is not about throwing them away.
It is about clarifying, tightening, and unifying them.

---

## 3. What actually changes in the new architecture

The new architecture changes emphasis in these ways.

| Original architecture tendency                                                  | New architecture direction                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| heavy repeated per-module taxonomy                                              | boundaries matter more than mandatory symmetry                                                             |
| module docs strongly enumerate DAW modules                                      | modules remain flexible; ownership matters more than fixed lists                                           |
| frontend and backend described separately                                       | one system architecture across all runtimes                                                                |
| stores sometimes become overly convenient                                       | stores are read/sync tools, not hidden write APIs                                                          |
| use cases are the public write boundary, but the write model is under-specified | use cases remain the write boundary, and commands/coalescing become more explicit                          |
| repositories are universal I/O adapters                                         | keep repositories as the TS I/O boundary; think in ports/adapters at system/native boundaries where useful |
| migration not explicit                                                          | migration is now a first-class staged strategy                                                             |

### Important clarification

The new architecture does **not** require renaming all repositories into adapters or ports on the TypeScript side.

For TypeScript modules:

- `useCases/` remain the public write boundary
- `repositories/` remain the I/O boundary
- `stores/` remain the public shared store surface
- `presentations/views/` remain the public UI composition surface

Do not waste migration effort renaming stable concepts when the real problem is boundary leakage.

---

## 4. Migration mindset

### 4.1 Converge, do not restart

The correct default is:

- preserve working behavior
- improve the nearest broken boundary
- avoid mass structural churn
- move code toward the target architecture gradually

### 4.2 Improve meaning, not cosmetics

A file moving into a prettier folder without improving ownership or dependency direction is not meaningful migration.

Migration is successful when:

- the write boundary becomes explicit
- runtime objects stop leaking into UI/business code
- repositories become thinner and more honest
- use cases become the real owner of business writes
- projections become read-only
- shell/framework logic stops owning core behavior
- external callers remain stable during staged migration

### 4.3 New code follows the target architecture immediately

Legacy code may remain temporarily.
New work should not extend legacy mistakes unless a stability constraint makes that unavoidable.

---

## 5. Migration priorities

When touching legacy code, improve in this order.

## 5.1 Highest priority

Always prioritize these first:

1. real-time safety
2. correctness of project-state ownership
3. explicit write boundaries
4. separation of runtime state from project/UI state
5. removal of business logic from views and shell code

## 5.2 Medium priority

Improve these when the surrounding code is already being touched:

1. projection clarity
2. event vs command clarity
3. repository honesty and adapter extraction where needed
4. DTO / transport cleanup
5. testability without React/Tauri

## 5.3 Lowest priority

Do not spend effort here unless it directly helps the items above:

1. folder renaming
2. file naming purity
3. splitting code into more modules just to look architectural
4. mechanically mirroring documents in the filesystem

---

## 6. The migration strategy in one picture

```text
OLD MODULE
  - mixed boundaries
  - hidden writes
  - UI/business/runtime leakage
  - external callers depend on legacy paths

        │
        │ module-local refactor only
        ▼

MIGRATED MODULE
  - cleaner internal boundaries
  - same external import paths still work
  - temporary compatibility shims preserve stability

        │
        │ after all modules are migrated
        ▼

FINAL CONVERGENCE
  - rewrite imports globally
  - remove temporary shims
  - tighten rules
  - simplify public surfaces
```

---

## 7. The most important migration rule

## 7.1 Preserve old external import paths during module-by-module migration

Because the codebase is large and one agent may be assigned per module, migrated modules must preserve a **legacy compatibility surface** until the final convergence pass.

That means:

- internal structure may change
- internal ownership may improve
- new canonical internal paths may be introduced
- but old external import paths used by other modules must keep working

This is not optional if the migration is happening in parallel.

## 7.2 Why this is necessary

If each module-refactor agent also rewrites imports across the rest of the codebase, the result is:

- merge conflicts
- duplicated work
- cross-module breakage
- rebasing hell
- partially migrated import graphs
- agents stepping on one another’s files

So migration must distinguish between:

1. **internal structural migration**
2. **external import-path convergence**

These are separate phases.

---

## 8. Legacy compatibility during migration

## 8.1 Compatibility exports are allowed during migration

If a module used to expose:

```text
src/modules/Arrangement/useCases/addTrack.ts
```

and the migrated implementation now lives at:

```text
src/modules/Arrangement/application/actions/addTrack.ts
```

then during migration it is acceptable to preserve the old path with a thin compatibility shim:

```typescript
/**
 * TEMPORARY MIGRATION SHIM
 *
 * Preserves the legacy external import path during module-by-module migration.
 * Remove after the global import convergence pass.
 */
export { addTrack } from '../application/actions/addTrack';
```

## 8.2 Why this is allowed

Normally, re-exporting through public paths can be fake compliance.

This migration pattern is different because it:

- preserves an already-existing public path
- does not widen the public surface
- is explicitly temporary
- is part of the staged migration plan
- exists to keep the codebase mergeable
- points inward to the new architecture

## 8.3 Conditions for a legitimate migration shim

A compatibility export is legitimate only if all of these are true:

1. the old path already existed or was already part of the public contract
2. the compatibility file contains no real business logic
3. the canonical implementation lives behind the compatibility surface
4. the compatibility layer is temporary
5. the compatibility layer is removable in the final convergence pass

---

## 9. What migration shims must never do

## 9.1 Forbidden uses of the compatibility layer

Do not use migration shims to:

- expose new private internals
- widen the public surface
- add business logic
- hide bad boundaries
- create new convenience imports
- postpone real cleanup forever

### Bad example: exposing new private internals

```typescript
export { internalTrackGraphBuilder } from '../runtime/internalTrackGraphBuilder';
```

### Bad example: adding behavior to the shim

```typescript
import { realAddTrack } from '../application/actions/addTrack';

export const addTrack = (input) => {
    validateSomethingExtra(input);
    return realAddTrack(input);
};
```

### Bad example: creating a new convenience public surface

```typescript
export { useTrackMeters } from '../presentations/hooks/useTrackMeters';
```

## 9.2 Quick test

A compatibility export is acceptable only if:

- it preserves an old contract
- it introduces no new behavior
- it contains no business logic
- it will be removed later

If any of those are false, it is probably fake compliance.

---

## 10. Public contract surfaces to preserve during migration

For TypeScript modules, the legacy/public contract surface is:

```text
errors/
events/
useCases/
stores/
presentations/views/
```

During module migration, agents must preserve external stability for these paths when they already exist and are used externally.

Private internals may be reorganized much more freely.

---

## 11. Migration mapping: old concepts to new concepts

## 11.1 What remains conceptually the same

| Original architecture concept                                                                               | Migration stance |
| ----------------------------------------------------------------------------------------------------------- | ---------------- |
| `models/` as plain TS types                                                                                 | keep             |
| `useCases/` as business write boundary                                                                      | keep             |
| `repositories/` as TS I/O boundary                                                                          | keep             |
| `stores/` as business/shared store surface                                                                  | keep             |
| `presentations/views/` as public UI surface                                                                 | keep             |
| `presentations/hooks/`, `context/`, `renderers/`, `presentations/stores/` as private presentation internals | keep             |
| engine as derived projection of project truth                                                               | keep             |
| Tauri bridge thinness                                                                                       | keep             |
| Rust domain crates Tauri-free                                                                               | keep             |

## 11.2 What changes in how agents should think

| Old tendency                                      | New migration direction                                |
| ------------------------------------------------- | ------------------------------------------------------ |
| use folder shape as architecture                  | use ownership and dependency direction as architecture |
| let stores quietly absorb write behavior          | restore explicit use-case ownership                    |
| let hooks/components contain business logic       | move business logic to use cases/domain helpers        |
| let repositories become mixed business/I/O layers | make repositories thinner and more honest              |
| treat renderers/hooks as harmless helpers         | keep them firmly in presentation                       |
| think in feature slices                           | think in DDD modules / bounded contexts                |

---

## 12. Migration decision tables

## 12.1 If you find this in old code, move it here

| Found in old code                                | Migrate toward                                       |
| ------------------------------------------------ | ---------------------------------------------------- |
| React component contains business rules          | use case / domain helper                             |
| hook performs project mutation inline            | use case                                             |
| hook calls Tauri `invoke` directly               | repository or bridge adapter                         |
| hook calls Web Audio API for business behavior   | engine boundary or repository/adapter                |
| direct cross-module store mutation               | owning module’s public use case                      |
| `AudioNode` or plugin handle in React/store      | engine/runtime-owned state                           |
| high-frequency meter updates through React state | telemetry + ref/render loop                          |
| persistence logic in UI hook                     | use case + repository                                |
| Tauri command doing business logic               | move logic into core/backend layer behind the bridge |
| renderer mutates truth                           | explicit use case/action boundary                    |

## 12.2 If you are unsure what kind of state something is

| Question                                       | If yes                 | If no                        |
| ---------------------------------------------- | ---------------------- | ---------------------------- |
| Is it saved with the project?                  | project state          | continue                     |
| Is it undoable?                                | probably project state | continue                     |
| Does it depend on live runtime resources?      | engine/runtime state   | continue                     |
| Is it only display feedback?                   | telemetry/projection   | continue                     |
| Is it only view interaction state?             | ephemeral UI state     | continue                     |
| Is it only a local component concern?          | local component state  | continue                     |
| Is it a user preference but not project truth? | persistent UI state    | shared runtime or reconsider |

## 12.3 If you are unsure whether to use a use case, event, store, or helper

| Need                                                 | Use                           |
| ---------------------------------------------------- | ----------------------------- |
| express a meaningful business write                  | use case / action / command   |
| let another concern react to a meaningful occurrence | event                         |
| expose read state                                    | store / projection / selector |
| share simple generic pure logic                      | helper/function               |
| bridge to external APIs                              | repository / adapter          |

---

## 13. Migration phases

The migration should generally happen in these recurring phases.

## 13.1 Phase 1: classify the code you are touching

Before changing code, identify:

- what kind of state it uses
- whether it performs writes or reads
- whether it crosses a runtime boundary
- whether it touches the RT path
- whether it owns business rules or only display logic
- whether external callers depend on its paths

### Classification checklist

1. Is this project truth, projection, runtime state, or UI state?
2. Who currently mutates it?
3. Who should mutate it?
4. Does it cross React/business/runtime/Tauri boundaries?
5. Is the current write path explicit or hidden?
6. Which old external paths must remain stable?
7. What is the smallest change that improves the boundary?

## 13.2 Phase 2: isolate the write boundary

If old code performs business changes from the wrong place, first introduce a clear write entry point.

Typical examples:

- extract mutation from a hook into a use case
- replace direct store writes with an owning use case
- replace scattered mutation helpers with one explicit public operation
- move business logic out of Tauri command handlers

This is usually the single most useful migration step.

## 13.3 Phase 3: isolate infrastructure

Once the write boundary is clear, move external API usage behind repositories/adapters.

Typical examples:

- move `invoke` calls out of hooks/use cases
- move browser storage access out of components
- move engine/runtime calls behind clearer boundaries
- wrap plugin host calls behind a dedicated repository or backend service boundary

## 13.4 Phase 4: split truth from projections

Once writes and infrastructure are clearer, separate authoritative state from derived read state.

Typical examples:

- replace direct UI mutation of engine state with project mutation + engine projection
- move high-frequency display data into telemetry paths
- turn mutable derived state into selectors/projections

## 13.5 Phase 5: preserve old external paths

If internal files moved, restore old external paths as thin compatibility exports.

This is mandatory during module-by-module migration.

## 13.6 Phase 6: simplify shape only after behavior is safe

Only after the above should you consider:

- file moves
- folder cleanup
- shape consolidation
- removal of stale wrappers

---

## 14. Safe migration patterns

## 14.1 Pattern: extract a real use case from a hook or component

### Legacy form

A hook or component:

- reads state
- validates
- writes project truth
- maybe calls runtime
- maybe updates UI state

### Target form

```text
presentation captures intent
  -> use case validates and mutates truth
  -> repository/adapters do I/O
  -> projections expose read state
```

### Migration steps

1. identify mutation logic
2. extract it to plain code outside React
3. define explicit input/output
4. keep the hook/component as a thin caller
5. later isolate any remaining I/O

## 14.2 Pattern: replace direct cross-module store mutation

### Legacy form

Module A directly writes module B’s state slice.

### Target form

Module A calls module B’s public use case, or emits a meaningful event if that pattern is appropriate.

### Migration steps

1. identify the owning module
2. identify or create the public write entry point
3. replace direct mutation with that call
4. remove any stale cross-module write helper

## 14.3 Pattern: move runtime handle leakage out of React

### Legacy form

A component, hook, or store holds:

- `AudioNode`
- plugin instance
- native runtime handle
- live engine object

### Target form

Runtime owns the handle.
UI sees only:

- IDs
- DTOs
- telemetry
- projections
- explicit callbacks/use cases

### Migration steps

1. keep the runtime object alive where it is for the moment
2. wrap it behind a cleaner boundary
3. replace UI/business consumers with IDs/DTOs/projections
4. move ownership fully into runtime code
5. remove leaked references

## 14.4 Pattern: move Tauri logic out of the business layer

### Legacy form

Use case or UI code directly knows Tauri command names or APIs.

### Target form

TypeScript business code depends on repositories.
Rust core code depends on Tauri-free crates.
`src-tauri` stays a bridge.

### Migration steps

1. define the capability boundary
2. move shell calls into a repository/bridge edge
3. keep use cases Tauri-free
4. keep Rust backend core Tauri-free

## 14.5 Pattern: split write model from telemetry

### Legacy form

Telemetry-like values are written into project stores or React state at high frequency.

### Target form

Telemetry flows through:

- channel
- ref
- projection
- render loop

Project truth changes only when explicitly committed.

---

## 15. High-risk migration zones

These areas require extra caution.

## 15.1 Real-time paths

Never “clean up” RT-path code casually.

Before modifying RT-adjacent code, verify:

- no new allocations
- no new locks
- no new React/DOM interaction
- no accidental sync IPC
- parameter vs topology distinction remains intact

## 15.2 Undo/redo code

Any write migration should answer:

- what is the write boundary now?
- does coalescing still work?
- does the operation remain replayable?
- are history semantics preserved?

## 15.3 Persistence

Do not break compatibility between:

- project truth
- serialization
- file migrations
- cache invalidation
- legacy load paths

## 15.4 Plugin hosting

Be explicit about what belongs to:

- project-side plugin model
- runtime plugin instance lifecycle
- editor window/control surface
- scan metadata
- failure state

## 15.5 Transport, routing, and engine projections

These often have invisible coupling.
Migrate boundary clarity first, internals second.

---

## 16. What each module migration agent should do

When assigned one module only, the agent should follow this order.

### Step 1: identify old external contract paths

Before moving files, determine which paths are imported from outside the module.

These paths become the temporary compatibility surface.

### Step 2: identify ownership and write problems

Find:

- hidden writes
- cross-module mutation
- mixed repository/use-case responsibilities
- UI/business/runtime leakage
- stale projections pretending to be truth

### Step 3: perform the internal refactor

The agent may:

- reorganize internals
- move logic to correct layers
- introduce clearer use cases
- thin repositories
- improve state ownership
- create new canonical internal paths

### Step 4: restore old external paths as compatibility exports

For every externally used old path that changed, preserve it with a thin temporary shim.

### Step 5: do not rewrite unrelated modules

Leave external callers alone unless the task explicitly includes the global convergence pass.

### Step 6: document temporary compatibility points

If helpful, add a standard annotation:

```typescript
/**
 * TEMPORARY MIGRATION SHIM
 *
 * Preserves the legacy external import path during module-by-module migration.
 * Remove after the global import convergence pass.
 */
export { addTrack } from '../application/actions/addTrack';
```

---

## 17. What the final convergence agent should do

Only after all module-local migrations are complete should one final convergence pass:

1. find remaining imports to legacy compatibility paths
2. rewrite them to canonical new paths
3. remove temporary compatibility shims
4. tighten dependency rules
5. verify that the migration layer is gone
6. simplify public surfaces where appropriate

This step is global by design.
It should not happen piecemeal during module-by-module migration.

---

## 18. Tooling implications

During migration, tooling may need to distinguish between:

- canonical architecture rules
- temporary legacy compatibility paths

### Recommended policy

- keep strict rules for canonical internals
- allow narrowly defined exceptions for documented migration shims
- forbid using migration exceptions to expose new internals
- remove migration exceptions after final convergence

In other words:

```text
make the migration layer explicit in tooling
not accidental in the codebase
```

---

## 19. Anti-patterns during migration

### 19.1 Introducing a parallel architecture

Do not create:

- new stores and old stores with overlapping truth
- new commands and old direct writes for the same behavior
- duplicate runtime entry points that drift

### 19.2 Rewriting working code only to match document vocabulary

Do not rename concepts just because the new docs use slightly different language.

Fix boundaries first.

### 19.3 Over-splitting modules during migration

Do not split one messy area into many abstract layers unless there is a real ownership/runtime reason.

### 19.4 Stuffing permanent logic into compatibility layers

A compatibility shim is a migration tool, not a permanent home.

### 19.5 Migrating reads before writes are understood

If ownership and write rules are unclear, read-model cleanup will usually create more confusion.

### 19.6 Widening the old public surface during migration

Migration must preserve old contracts, not expand them.

---

## 20. What “done” looks like for a migrated module

A module is meaningfully migrated when:

- authoritative state ownership is clearer
- writes go through an explicit public use case/action/command
- runtime state is no longer stored in UI/business state
- repositories/adapters own external I/O more honestly
- projections are read-only and derivable
- React or Tauri no longer own core business behavior
- behavior is preserved or intentionally improved
- old external import paths still work through thin temporary shims if needed

A migrated module does **not** need:

- perfect folder symmetry
- full repo-wide import rewrites
- removal of all temporary shims immediately
- a big-bang rewrite into idealized shapes

---

## 21. Practical checklist for a module migration agent

Before finishing, verify:

1. Did I improve the module’s internal boundaries?
2. Did I make the write boundary more explicit?
3. Did I preserve behavior?
4. Did I preserve old external import paths that other modules still rely on?
5. Are compatibility files thin and honest?
6. Did I avoid widening the public surface?
7. Did I avoid rewriting unrelated modules’ imports?
8. Will this merge cleanly with other module migrations?

If yes, the migration is correctly staged.

---

## 22. Final rule

The migration succeeds in two steps:

```text
1. every module becomes internally cleaner while externally stable
2. one final global pass updates imports and removes the compatibility layer
```

Do not force codebase-wide convergence early.

During migration:

```text
preserve legacy external paths
modernize internals
avoid fake compliance
improve the nearest real boundary
```

That is the intended migration strategy.
