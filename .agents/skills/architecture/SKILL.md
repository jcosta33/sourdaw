---
name: architecture
description: >-
  Author module code against Sourdaw's DDD boundaries: contract barrels, stores as
  public read contracts, UI → business → IO flow, and composition shells. ALWAYS
  apply when creating modules, moving code between layers, adding cross-module
  imports, wiring use cases or stores, or designing presentation access to other
  domains. Do not invent a fifth barrel, deep-import private folders, or treat
  stores as free global write APIs — apply first. Skip pure styling, single-file
  renames inside one folder, and violation remediation (use architecture-violations).
---

## Purpose

Modules must stay independently understandable. When the boundary leaks — a presentation file importing a foreign repository, a use case importing `presentations/`, a model climbing into the engine — the cost surfaces months later as cascading rewrites and RT-unsafe paths. This skill is how to build on the right side of the boundary. When a check already failed, load `architecture-violations` instead.

## Core rules

### 1. Cross-module imports only through contract-folder barrels

Each module may expose **up to four** permitted contract surfaces — create only those it actually needs:

- `#/modules/<M>/useCases` — operations (functions/constants only; no type re-exports)
- `#/modules/<M>/stores` — **read** contract for domain/UI working state
- `#/modules/<M>/events` — typed cross-module payloads
- `#/modules/<M>/presentations/views` — composable view entry points

There is **no** module-root `index.ts`. Deep imports into private paths (`models/`, `repositories/`, `handlers/`, `engine/`, …) are forbidden — including from tests.

```typescript
// ✅
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';

// ❌
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { type Track } from '#/modules/Arrangement/models/Track';
```

Enforced by `cross-module-index-only`, `contract-barrel-scope`, `no-models-repos-transformers-in-index`, and the test-inclusive cruise.

**Why:** the barrel is the curated public surface. A deep import freezes private layout and lets model changes cascade across modules.

### 2. Same module uses relative imports — never own barrels

Inside `src/modules/Arrangement/`, import with relatives (`../stores/trackStore`, `./addTrack`). Do not import `#/modules/Arrangement/useCases` from inside Arrangement.

**Why:** barrels are for external consumers. Intra-module barrel use creates cycles and fails `no-self-barrel-import` / `no-internal-barrel-import`.

### 3. Stores are a public read contract; writes stay with the owner

Other modules may subscribe via `useStore` / selectors. They must not call `store.set` on a foreign store (**agent policy**; ESLint `sourdaw/no-foreign-store-write` is **warn** only — not a `deps:validate` error). Route mutations through the owning module's use cases or `executeAppAction`. Leaf components: no **direct** business-store import (**error** `components-no-business-store-access`).

```typescript
import { trackStore } from '#/modules/Arrangement/stores';
import { useStore } from '#/infra/store/useStore';
const tracks = useStore(trackStore);

import { executeAppAction } from '#/modules/Command/useCases';
await executeAppAction({ type: 'track/add', payload: { /* … */ } });
```

**Why:** global visibility without global mutability keeps undo, CRDT, and invariants in one place.

### 4. Dependency direction is UI → business → IO

```
presentations/  →  useCases/  →  repositories/ | stores/ | services/
                     handlers/ (private; registered for Command)
```

- Business/IO must not import `presentations/` (`business-no-presentations`).
- Only `useCases/` orchestrate `repositories/` (`usecases-only-write-boundary-to-repositories`).
- Repositories must not import any-module `useCases|handlers|presentations` (`repositories-no-business`).
- Models stay pure (`models-are-pure`); events stay pure (`events-are-pure`).

**Why:** reversing the arrow couples domain logic to React lifecycle and makes RT paths unknowable.

### 5. Leaf components stay dumb; composition shells use barrels

Views and hooks may import foreign contract barrels. Leaf `presentations/components/` and `src/components/` must not **directly** import business stores or useCases (`components-no-business-store-access`, `components-no-usecase-access`); no **transitive** useCases reach (`components-no-usecase-transitively`); no views (`components-no-view-access`). Presentation must not import repositories, handlers, or engine: **same-module** via `presentation-no-direct-*` (**error**); **cross-module** deep private via `cross-module-index-only` (**error**).

**Why:** leaf components that own business calls become untestable mini-views and trip the reachability gate.

### 6. Use-case types stay private; one function per file

Do not `export type` from `useCases/index.ts` (`no-usecase-type-exports-on-index` on the types cruise). Consumers use `ReturnType`/`Parameters` or payloads via `events/`. Each use-case and repository file exports exactly one function. Handlers are private under `handlers/`; cross-module access only via `get<Module>Handlers` from `useCases/`.

**Why:** type re-exports freeze private shapes; multi-export wrappers become laundering barrels.

### 7. Repositories touch metal; engine does not import repositories

I/O (storage, Web Audio setup, Tauri IPC) belongs in `repositories/`. Engine receives deps from use cases — never imports repositories (**error** `usecases-only-write-boundary-to-repositories`). Tauri IPC placement is also **policy** with depcruise **warn** (`tauri-ipc-only-in-repositories`) — not an error gate.

**Why:** engine → repository couples graph/RT code to I/O and breaks the use-case write boundary.

## What does not belong

- Pure styling / className tweaks with no import or boundary change.
- Single-file renames inside one folder that do not cross layers.
- Gaming a red `deps:validate` — that is `architecture-violations`.
- Inventing a fifth contract surface or a module-root `index.ts`.

## Anti-patterns

### CRITICAL — Cross-module private import

❌ Wrong: `import { type Track } from '#/modules/Arrangement/models/Track'`

✅ Correct: call Arrangement use cases / read stores / define a local shape; shared named types go through `events/` when required.

### CRITICAL — Business importing presentations

❌ Wrong: `useCases/initTimelineRenderer` imports `presentations/renderers/…`

✅ Correct: keep renderer factories under presentations and call them from views/hooks, or move pure factory code out of presentations.

### CRITICAL — Boundary evasion (malicious compliance)

❌ Wrong: re-export a repository through a use-case file so the import path is “legal”.

✅ Correct: a real typed use case that owns the operation; consumers import the function, not the private symbol.

### HIGH — Component owns business calls or store reads

❌ Wrong: `presentations/components/VoiceButton.tsx` imports `AiRuntime/stores`

✅ Correct: view/hook reads the store and passes props/callbacks into the leaf component.

### HIGH — Foreign store write

❌ Wrong: `trackStore.set(…)` from another module

✅ Correct: owning use case or `executeAppAction`.

### MEDIUM — Same-module barrel import

❌ Wrong: inside Arrangement, `import { addTrack } from '#/modules/Arrangement/useCases'`

✅ Correct: relative path to the defining file.

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — module anatomy, contract barrels, layering.
- `.dependency-cruiser.cjs` — machine-validated boundary rules. Run `pnpm deps:validate` (main + reachability + types + tests cruises).
