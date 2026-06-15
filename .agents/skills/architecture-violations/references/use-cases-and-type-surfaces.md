# Use cases — behavior crosses modules; types stay local

Deep mechanics behind Core rule 6 (no laundering) and Core rule 7 (one function
per file). A use case is the **callable** cross-module contract. Other modules
import **functions** from `#/modules/<Module>` — not types defined in that
module's `useCases/`. Each consumer module keeps its own types (or uses
`ReturnType<typeof fn>` / `Parameters<typeof fn>`). **Event payload types** in
`events/` are the shared type surface when a named cross-module type is required.

---

## 1. What a legitimate use case looks like

Every use case file must export its own typed function:

- The file exports a named function (or arrow) written by the module that owns the use case.
- **Types** used in the signature (`input`, return DTOs, etc.) are **internal** to the module — they are not re-exported from `index.ts` and are not imported by other modules via `import type` from `#/modules/...`.
- The input and output types may use this module's `models/`, repositories' pure-model types (§4, intra-module only), or inline types in the file — see `AGENTS.md` model isolation for cross-module data shapes.
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

The repository is free to change its internal implementation; the use case
absorbs the change. Another module imports `getNextClipId` and does not import a
type alias for its return type from Arrangement's use cases.

## 2. What is forbidden

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

This creates no boundary. The consumer imports the repository symbol verbatim,
under a different path. If the repository signature changes, every consumer
breaks. There is no translation, no contract, no ownership change across the file.

**Re-exporting non-contract internals from a contract-folder barrel:**

```ts
// FORBIDDEN — useCases/index.ts may only re-export from useCases/**
export { Track } from '../models/Track';
export { getTrackById } from '../repositories/track/getTrackById';
export { TrackNotFoundError } from '../errors/TrackNotFoundError';
export type { TrackSummary } from './getTrackSummary'; // use-case types do not cross
export { trackStore } from '../stores/trackStore'; // wrong folder
```

These patterns are non-compliant even if cmdValidate passes — a fake public
surface does not become a real one just because the path resolves.

If there is nothing to add to a use-case body, define a proper typed function
that calls the repo. The function _is_ the boundary.

## 3. Internal DTOs when the repository shape is not safe to leak

If the repository returns a framework-coupled object or internal entity shape,
the use case defines **internal** types to map or narrow — those types stay in
the module (not on `index.ts`):

```ts
// Internal to the module — not exported from index.ts for other modules
type TrackSummary = { id: string; name: string; kind: TrackKind };

export function getTrackSummary(input: { trackId: string }): TrackSummary | null {
    const entity = trackRepository.get(input.trackId);
    if (!entity) return null;
    return { id: entity.id, name: entity.name, kind: entity.kind };
}
```

Other modules import `getTrackSummary` only; they define their own local types or
use `ReturnType<typeof getTrackSummary>` if needed.

## 4. Repo types the use case may reference (intra-module)

Inside a module, a repository may expose **pure-model** types for the use case to
use in signatures — plain data shapes with no behavior, no framework coupling,
and no internal-implementation leakage. `type DocId = string` is a pure model. A
class instance, a mutable handle, or a type tied to infrastructure is not.

Those types do not become other modules' imports — consumers stay decoupled
(see `AGENTS.md`).

When in doubt, keep types private to the use case file or use `models/` inside
the module only.

## 5. One function per file

Each use case lives in its own file, named after the function. A file that
exports many thin wrappers over a repository (e.g. `crdtRepositoryAccess.ts` with
8 re-exports) violates both §2 (laundering) and the One Function Per File rule.
Split it into N files, one per function, each with a real typed signature.

### 5.1 What types a use case file may export

A use case file may declare and export **its own local types** — the function's
`Input` / `Output` aliases, an internal DTO it produces, narrowing helpers used
only by that function. These are part of the use case's own definition, not
borrowed from elsewhere.

What a use case file **must never** export — by re-export or otherwise:

- **Model types or model values** from `../models/...`. Models are private to the owning module. A line like `export type { Track } from '../models/Track'` or `export { createTrack } from '../models/Track'` inside a use case file is **forbidden**: it launders private state through a fake public path. If a use case needs to expose data shaped like a model, it defines its own DTO with only the fields the contract requires.
- **Repository types or repository values** from `../repositories/...`. Repositories are I/O internals. `export { saveX } from '../repositories/...'` is forbidden under §2; the same rule covers `export type`.
- **Types from `../services/`, `../validators/`, `../transformers/`, `../engine/`, `../errors/`, `../handlers/`**. These folders are private. Their types do not cross via a use case file.

The rule of thumb: if the type is **defined in this file**, exporting it is fine.
If the type is **imported from another folder**, re-exporting it from a use case
file is laundering — stop and reconsider.

### 5.2 Acceptable cross-module type surfaces

Cross-module type consumption goes through the module's contract-folder barrel or
it does not happen. The legal type surfaces are:

| Type origin                                                                                                              | Cross-module export rule                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events/` payloads                                                                                                       | **Allowed.** `export type { FooEvent } from './FooEvent'` in `events/index.ts` — the canonical shared type surface.                                                                                                                                      |
| `stores/` value types                                                                                                    | **Allowed.** A `Store<T>` is part of the public contract, so its `T` can be re-exported alongside the store instance from `stores/index.ts`.                                                                                                             |
| `useCases/` local types                                                                                                  | **Discouraged but legal.** Prefer `ReturnType<typeof fn>` / `Parameters<typeof fn>` or a local shape in the consumer. If a type genuinely must cross, it goes via an `export type { … } from './...'` line on `useCases/index.ts` — never a deep import. |
| Anything from `models/`, `repositories/`, `services/`, `validators/`, `transformers/`, `engine/`, `errors/`, `handlers/` | **Forbidden** — not from any barrel, not laundered through a use case file, not anywhere.                                                                                                                                                                |

If you find yourself wanting to re-export a model type so another module can name
it, the answer is always: **define a local type in the consumer**. The
duplication is intentional (see `AGENTS.md` model isolation).

## 6. Command handler registry typing (`get<Module>Handlers`)

**`Record<string, ActionHandler<any>>` erases the relationship between registry
keys and `AppAction` variants.** For a fixed domain of actions, derive a precise
map type from `AppAction` so each entry is `ActionHandler<ThatAction>` and
`execute` / `describe` narrow on the payload.

1. **Union of actions** — `type DomainAppAction = Extract<AppAction, { type: 'foo' }> | Extract<AppAction, { type: 'bar' }> | …` (one `Extract` per discriminant; stays in sync when `commandQueries` payloads change).
2. **Mapped registry type** — `type DomainHandlersMap = { [Action in DomainAppAction as Action['type']]: ActionHandler<Action> };`
3. **Assembly** — `get<Module>Handlers` returns a plain object literal `{ actionKey: handle…, … }` with type `DomainHandlersMap`, importing each `handle…` **directly** from `handlers/…` (no intermediate "map barrel" file). `createHandler` builds each handler in `handlers/`. **`get<Module>Handlers`** does not call `createHandler` itself.

Re-export the map type from the `get<Module>Handlers` file when other modules or
tests need the same contract.

## 7. Summary test

Before committing a use-case file, ask:

1. Does this file export its own typed function, not a re-export?
2. If the signature uses repo types, are those types pure models and only referenced **inside this module**?
3. Are we avoiding `export type` of use-case types on `index.ts` and avoiding cross-module `import type` of those types?

If any answer is no, the boundary is fake or the type surface is too wide.
