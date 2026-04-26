---
name: architecture-violations
description: Apply when fixing architecture violations, refactoring modules, restructuring boundaries, or performing codebase audits. Contains mandatory rules for addressing violations properly without hacking around the architecture. Prevents ad-hoc barrel re-exports outside contract-folder barrels, fake use cases, dumping unrelated logic into single files, shadow shared layers, and other forms of malicious or fake compliance.
---

# Architecture Violations Skill

This document explains **why** the architecture must be followed, **how** to reason about real compliance, and **which forms of fake or malicious compliance are forbidden**.

It applies to both AI agents and human maintainers.

This is not another architecture overview. It is a guardrail document for preventing architectural drift, shortcut-driven refactors, validator gaming, and code that "passes the rules" without preserving the meaning of the rules.

**Canonical module-boundary reference:** `docs/architecture/03-typescript-module.md` §3.3 (contract-folder barrels) and §3.1 (public contract surface).

---

## 1. When to Apply This Skill

Apply this skill when:

- fixing any architecture violation detected by `pnpm deps:validate`
- restructuring a feature or module
- moving logic across layers
- introducing new public surfaces
- adding adapters, stores, use cases, or projections
- cleaning up tech debt
- performing a codebase audit
- refactoring legacy code toward the new architecture
- reviewing whether a change is _actually_ compliant or only cosmetically compliant

---

## 2. Core Principle

**Fix violations properly — never hack around the rules.**

If a violation exists, the correct fix is to establish the proper architecture so the code flows through the right boundary.

Never:

- change validation rules to make violations pass
- create barrel exports (other than the four contract-folder `index.ts` files) of non-contract entities to bypass restrictions
- move code into a "fake" use case, action, or projection file just to make imports legal
- rename files or folders to trick the validator
- move forbidden logic into `src/helpers/`, `src/shared/`, `utils/`, or other ungoverned escape hatches
- split code into many tiny files without improving responsibilities
- collapse multiple responsibilities into a giant "allowed" file
- keep unauthorized mutation but wrap it behind an allowed import path
- create compatibility wrappers that become permanent shadow architecture

A refactor is compliant only if it improves or preserves the _meaning_ of the boundary, not just the path.

### 2.1 The Three Strikes Rule & Strategic Backtracking

If you attempt to fix an architectural violation or compilation error 3 times and fail, **you must stop**. You are on the wrong architectural path. Do not enter a hallucination loop patching broken abstractions. Discard your current approach, reread the module contracts, and formulate a fundamentally different strategy.

### 2.2 Blast Radius Awareness

When fixing violations, do not suffer from tunnel vision. Trace the upstream callers and downstream dependencies of the files you move. Use the TypeScript compiler (`pnpm typecheck`) to exhaustively navigate the blast radius of your changes.

---

## 3. Why Compliance Matters

Architecture compliance is not cosmetic consistency.

The architecture exists because this DAW has hard constraints that cannot be negotiated away by clever code organization.

### 3.1 Real-time safety is fragile

In a DAW, the real-time boundary is more important than aesthetics.

If allocations, locks, UI coupling, shell coupling, or other unsafe behavior leak into runtime-sensitive paths, the result is not merely impurity. It can cause:

- audio glitches
- instability
- timing drift
- impossible-to-reproduce bugs
- performance collapse under load

The architecture exists partly to keep real-time execution isolated from everything that is not real-time safe.

### 3.2 Shared state without ownership becomes corruption

The project model is the source of truth. That only works if ownership is real.

If multiple features casually mutate shared state because it is convenient, then:

- undo semantics become unclear
- persistence no longer reflects clear intent
- collaboration becomes harder later
- bugs become distributed instead of local
- refactors cannot be trusted

The architecture exists to preserve one owner per authoritative write surface, while still allowing broad read access via stores and projections.

### 3.3 UI coupling destroys reuse and correctness

When business logic lives in hooks, components, or shell entry points, it becomes:

- harder to test
- harder to reuse
- easier to accidentally duplicate
- dependent on rendering and lifecycle quirks
- vulnerable to shortcut code

The architecture exists so business logic can be reasoned about independently of React, Tauri, and imperative rendering.

### 3.4 Thin shell, thick core is not optional

Tauri, browser APIs, Web Audio setup, IndexedDB, filesystem operations, and plugin-host mechanics are real concerns, but they are not the business model.

If shell/framework code becomes the de facto owner of logic, the result is:

- runtime lock-in
- poor testability
- logic duplication across runtimes
- hidden infrastructure assumptions inside business behavior

The architecture exists to keep infrastructure replaceable and business logic stable.

### 3.5 AI agents optimize locally unless constrained

AI agents are very good at making a change "work" locally.
They are much less reliable if the system tolerates shortcut patterns that technically pass linting and dependency rules but violate architectural intent.

This means the codebase needs explicit protection against:

- shortcut abstractions
- fake boundary layers
- pass-through facades
- hidden write surfaces
- giant files that flatten layers
- barrel-export laundering
- compatibility wrappers that become permanent shadow architecture

This skill exists to prevent that.

---

## 4. Semantic Compliance vs Cosmetic Compliance

A change is compliant only if it preserves the meaning of the boundary, not just the path structure.

### 4.1 Real compliance

A change is compliant when it improves or preserves:

- ownership
- write discipline
- runtime isolation
- testability
- truth vs projection separation
- framework independence of business logic
- real-time safety

### 4.2 Fake compliance

A change is fake-compliant when it:

- passes dependency-cruiser by routing imports through laundering files
- moves logic into approved folders without changing dependency meaning
- introduces pass-through layers with no real separation
- collapses many concerns into one giant "allowed" file
- preserves hidden bidirectional coupling through indirection
- leaves unauthorized mutation intact while renaming entry points
- keeps runtime ownership in UI code while wrapping it in helper functions

If the architectural meaning did not improve, the refactor did not comply.

### 4.3 The key test

**A boundary is only real if responsibility changes across it.**

If a layer exists only to satisfy the validator while the real logic still lives in the wrong place, it is non-compliant.

### 4.4 Shim annotation-removal is not a refactor

A `TEMPORARY MIGRATION SHIM` (or any similar annotation) is not a comment. It is a task marker: it exists to trigger a real refactor.

Removing the annotation from a file that is still a pure re-export — e.g. `export { getX } from '../repositories/Y'` — does **not** make the file architecturally sound. The code still launders private access through a fake public surface, and the boundary is still non-existent.

The refactor that discharges a shim annotation is creating a real typed boundary (see §6). Deleting the comment without doing the refactor is malicious compliance, regardless of whether `deps:validate` still passes.

If you cannot complete the refactor in the current session, leave the annotation in place and document the reason in the task file.

---

## 5. Module Boundary: contract-folder barrels

Each module exposes **four independently-importable contract surfaces**. There is **no module-root `index.ts`**.

```text
src/modules/ModuleName/useCases/index.ts          ← business operations
src/modules/ModuleName/stores/index.ts            ← Store<T> instances
src/modules/ModuleName/events/index.ts            ← typed event payload types (if any)
src/modules/ModuleName/presentations/views/index.ts  ← composable UI entry points (if any)
```

Each `<contract>/index.ts` may only re-export from files within its own folder. `useCases/index.ts` must not import from `stores/`, and vice versa.

Everything else — `models/`, `repositories/`, `services/`, `validators/`, `transformers/`, `presentations/hooks/`, `presentations/stores/`, `presentations/context/`, `presentations/components/`, `presentations/renderers/`, `engine/`, `runtime/`, `worklets/`, `errors/`, `handlers/` — is private. External consumers never import those paths directly.

### Importing cross-module

```ts
// CORRECT — import from contract-folder barrel
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import type { TrackAddedEvent } from '#/modules/Arrangement/events';
import { ArrangementBar } from '#/modules/Arrangement/presentations/views';

// FORBIDDEN — direct file access from outside the module
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

// FORBIDDEN — root index.ts does not exist in a migrated module
import { addTrack, trackStore } from '#/modules/Arrangement';
```

### Importing inside the same module (never own contract barrels)

Files under `src/modules/<Name>/` must **not** import from `#/modules/<Name>/useCases`, `#/modules/<Name>/stores`, etc. Use **relative** paths.

```ts
// CORRECT — Arrangement file importing Arrangement internals
import { trackStore } from '../stores/trackStore';
import { addClip } from './useCases/clip/addClip';

// FORBIDDEN — same module importing its own contract barrel
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip } from '#/modules/Arrangement/useCases';
```

### Writing a contract-folder barrel

```ts
// src/modules/Arrangement/useCases/index.ts — curated use cases barrel
export { addTrack } from './addTrack';
export { removeTrack } from './removeTrack';
export { getArrangementHandlers } from './getArrangementHandlers';

// FORBIDDEN inside useCases/index.ts:
export type { SomeDto } from './getThing'; // use-case types do not cross modules
export { Track } from '../models/Track'; // models/ is private; wrong folder
export { trackStore } from '../stores/trackStore'; // wrong folder — use stores/index.ts
```

```ts
// src/modules/Arrangement/stores/index.ts — curated stores barrel
export { trackStore, defaultTrackState } from './trackStore';
export type { TrackStoreState } from './trackStore';

// FORBIDDEN inside stores/index.ts:
export { addTrack } from '../useCases/addTrack'; // wrong folder — use useCases/index.ts
```

### No module-root `index.ts`

Do not add `<module>/index.ts` or `<module>/contract.ts` aggregation shims. If a module you're working in still has a root `index.ts`, that is a legacy module awaiting migration — do not add new exports to it. Create or extend the contract-folder barrels instead.

---

## 6. Use cases — behavior crosses modules; types stay local

A use case is the **callable** cross-module contract. Other modules import **functions** from `#/modules/<Module>` — not types defined in that module’s `useCases/`. Each consumer module keeps its own types (or uses `ReturnType<typeof fn>` / `Parameters<typeof fn>`). **Event payload types** in `events/` are the shared type surface when a named cross-module type is required.

### 6.1 What a legitimate use case looks like

Every use case file must export its own typed function:

- The file exports a named function (or arrow) written by the module that owns the use case.
- **Types** used in the signature (`input`, return DTOs, etc.) are **internal** to the module — they are not re-exported from `index.ts` and are not imported by other modules via `import type` from `#/modules/...`.
- The input and output types may use this module’s `models/`, repositories’ pure-model types (§6.4, intra-module only), or inline types in the file — see `AGENTS.md` model isolation for cross-module data shapes.
- The function body may be thin. `return someRepo.method(input)` is acceptable — a use case is allowed to delegate to a private repository.
- **Within the same module**, callers use **relative** paths to the file that defines the symbol (`./useCases/<file>`, `../stores/…`, etc.). They must **not** import from `#/modules/<ThisModule>`. Same-module `import type` from a co-located use case file is fine.
- **From another module**, callers import **values** from `#/modules/<Module>` only (`export { fn }` on `index.ts`). No `export type { … } from './useCases/…'` on `index.ts`.
- Across a module boundary, callers never import `repositories/`; the use case hides the repository.

```ts
// Arrangement/useCases/getNextClipId.ts — legitimate thin use case
import { getNextClipId as allocateClipIdFromCounter } from '../repositories/clipIdCounter';

export function getNextClipId(): string {
    return allocateClipIdFromCounter();
}
```

The repository is free to change its internal implementation; the use case absorbs the change. Another module imports `getNextClipId` and does not import a type alias for its return type from Arrangement’s use cases.

### 6.2 What is forbidden

**Importing cross-module directly into a file instead of through a contract-folder barrel:**

```ts
// FORBIDDEN — bypasses the module boundary (direct file access)
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

// CORRECT — goes through the contract-folder barrel
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
```

**Importing use-case types from another module:**

```ts
// FORBIDDEN — types defined in useCases/ are not a cross-module surface
import type { TrackSummary } from '#/modules/Arrangement/useCases';

// Prefer: local shape, or ReturnType<typeof getTrackSummary> after importing the function
```

**Re-exporting a repository function through a use-case file:**

```ts
// FORBIDDEN — laundering private access through a fake boundary
export { getNextClipId } from '../repositories/clipIdCounter';
export * from '../repositories/automergeRepository';
```

This creates no boundary. The consumer imports the repository symbol verbatim, under a different path. If the repository signature changes, every consumer breaks. There is no translation, no contract, no ownership change across the file.

**Re-exporting non-contract internals from a contract-folder barrel:**

```ts
// FORBIDDEN — useCases/index.ts may only re-export from useCases/**
export { Track } from '../models/Track';
export { getTrackById } from '../repositories/track/getTrackById';
export { TrackNotFoundError } from '../errors/TrackNotFoundError';
export type { TrackSummary } from './getTrackSummary'; // use-case types do not cross
export { trackStore } from '../stores/trackStore'; // wrong folder
```

These patterns are non-compliant even if `deps:validate` passes — a fake public surface does not become a real one just because the path resolves.

If there is nothing to add to a use-case body, define a proper typed function that calls the repo. The function _is_ the boundary.

### 6.3 Internal DTOs when the repository shape is not safe to leak

If the repository returns a framework-coupled object or internal entity shape, the use case defines **internal** types to map or narrow — those types stay in the module (not on `index.ts`):

```ts
// Internal to the module — not exported from index.ts for other modules
type TrackSummary = { id: string; name: string; kind: TrackKind };

export function getTrackSummary(input: { trackId: string }): TrackSummary | null {
    const entity = trackRepository.get(input.trackId);
    if (!entity) return null;
    return { id: entity.id, name: entity.name, kind: entity.kind };
}
```

Other modules import `getTrackSummary` only; they define their own local types or use `ReturnType<typeof getTrackSummary>` if needed.

### 6.4 Repo types the use case may reference (intra-module)

Inside a module, a repository may expose **pure-model** types for the use case to use in signatures — plain data shapes with no behavior, no framework coupling, and no internal-implementation leakage. `type DocId = string` is a pure model. A class instance, a mutable handle, or a type tied to infrastructure is not.

Those types do not become other modules’ imports — consumers stay decoupled (see `AGENTS.md`).

When in doubt, keep types private to the use case file or use `models/` inside the module only.

### 6.5 One function per file

Each use case lives in its own file, named after the function. A file that exports many thin wrappers over a repository (e.g. `crdtRepositoryAccess.ts` with 8 re-exports) violates both §6.2 (laundering) and the One Function Per File rule. Split it into N files, one per function, each with a real typed signature.

### 6.5.1 What types a use case file may export

A use case file may declare and export **its own local types** — the function's `Input` / `Output` aliases, an internal DTO it produces, narrowing helpers used only by that function. These are part of the use case's own definition, not borrowed from elsewhere.

What a use case file **must never** export — by re-export or otherwise:

- **Model types or model values** from `../models/...`. Models are private to the owning module. A line like `export type { Track } from '../models/Track'` or `export { createTrack } from '../models/Track'` inside a use case file is **forbidden**: it launders private state through a fake public path. If a use case needs to expose data shaped like a model, it defines its own DTO with only the fields the contract requires.
- **Repository types or repository values** from `../repositories/...`. Repositories are I/O internals. `export { saveX } from '../repositories/...'` is forbidden under §6.2; the same rule covers `export type`.
- **Types from `../services/`, `../validators/`, `../transformers/`, `../engine/`, `../errors/`, `../handlers/`**. These folders are private. Their types do not cross via a use case file.

The rule of thumb: if the type is **defined in this file**, exporting it is fine. If the type is **imported from another folder**, re-exporting it from a use case file is laundering — stop and reconsider.

### 6.5.2 Acceptable cross-module type surfaces

Cross-module type consumption goes through the module's contract-folder barrel or it does not happen. The legal type surfaces are:

| Type origin                                                                                                              | Cross-module export rule                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events/` payloads                                                                                                       | **Allowed.** `export type { FooEvent } from './FooEvent'` in `events/index.ts` — the canonical shared type surface.                                                                                                                                      |
| `stores/` value types                                                                                                    | **Allowed.** A `Store<T>` is part of the public contract, so its `T` can be re-exported alongside the store instance from `stores/index.ts`.                                                                                                             |
| `useCases/` local types                                                                                                  | **Discouraged but legal.** Prefer `ReturnType<typeof fn>` / `Parameters<typeof fn>` or a local shape in the consumer. If a type genuinely must cross, it goes via an `export type { … } from './...'` line on `useCases/index.ts` — never a deep import. |
| Anything from `models/`, `repositories/`, `services/`, `validators/`, `transformers/`, `engine/`, `errors/`, `handlers/` | **Forbidden** — not from any barrel, not laundered through a use case file, not anywhere.                                                                                                                                                                |

If you find yourself wanting to re-export a model type so another module can name it, the answer is always: **define a local type in the consumer**. The duplication is intentional (see `AGENTS.md` model isolation).

### 6.6 Command handler registry typing (`get<Module>Handlers`)

**`Record<string, ActionHandler<any>>` erases the relationship between registry keys and `AppAction` variants.** For a fixed domain of actions, derive a precise map type from `AppAction` so each entry is `ActionHandler<ThatAction>` and `execute` / `describe` narrow on the payload.

1. **Union of actions** — `type DomainAppAction = Extract<AppAction, { type: 'foo' }> | Extract<AppAction, { type: 'bar' }> | …` (one `Extract` per discriminant; stays in sync when `commandQueries` payloads change).
2. **Mapped registry type** — `type DomainHandlersMap = { [Action in DomainAppAction as Action['type']]: ActionHandler<Action> };`
3. **Assembly** — `get<Module>Handlers` returns a plain object literal `{ actionKey: handle…, … }` with type `DomainHandlersMap`, importing each `handle…` **directly** from `handlers/…` (no intermediate “map barrel” file). `createHandler` builds each handler in `handlers/`. **`get<Module>Handlers`** does not call `createHandler` itself.

Re-export the map type from the `get<Module>Handlers` file when other modules or tests need the same contract.

### 6.7 Summary test

Before committing a use-case file, ask:

1. Does this file export its own typed function, not a re-export?
2. If the signature uses repo types, are those types pure models and only referenced **inside this module**?
3. Are we avoiding `export type` of use-case types on `index.ts` and avoiding cross-module `import type` of those types?

If any answer is no, the boundary is fake or the type surface is too wide.
