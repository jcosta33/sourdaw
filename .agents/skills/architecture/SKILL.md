---
name: architecture
description: >-
    Author module code against Sourdaw's DDD boundaries: contract barrels, stores as
    public read contracts, UI → business → IO flow, and composition shells. ALWAYS
    apply when creating modules, moving code between layers, adding cross-module
    imports, wiring use cases or stores, or designing presentation access to other
    domains. Skip pure styling, single-file renames inside one folder, and violation
    remediation (use architecture-violations).
---

## Purpose

A leaked boundary — presentation importing a foreign repository, a use case importing `presentations/`, a model climbing into the engine — surfaces months later as cascading rewrites and RT-unsafe paths.

## Core rules

### 1. Cross-module imports only through contract-folder barrels

A module exposes only these surfaces, and only the ones it needs:

- `#/modules/<M>/useCases` — operations (functions/constants only; no type re-exports)
- `#/modules/<M>/stores` — **read** contract for domain/UI working state
- `#/modules/<M>/events` — typed cross-module payloads
- `#/modules/<M>/presentations/views` — composable view entry points

There is **no** module-root `index.ts`; the architecture checker rejects one even when empty. Deep imports into private paths (`models/`, `repositories/`, `handlers/`, `engine/`, …) are forbidden, including from tests and shared/app/route code.

```typescript
// ✅
import { addTrack } from '#/modules/Arrangement/useCases';

// ❌
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { type Track } from '#/modules/Arrangement/models/Track';
```

Enforced by `cross-module-index-only`, `contract-barrel-scope`, `no-models-repos-transformers-in-index`, and the test-inclusive cruise.

**Why:** the barrel is the curated public surface. A deep import freezes private layout and lets model changes cascade across modules.

### 2. Same module uses relative imports — never own barrels

Inside `src/modules/Arrangement/`, import relatively (`../stores/trackStore`, `./addTrack`). Never import your own module's barrels (`no-self-barrel-import`, `no-internal-barrel-import`).

**Why:** barrels serve external consumers; intra-module barrel use creates cycles.

### 3. Stores are a public read contract; writes stay with the owner

Foreign modules read a store by subscribing with `useStore` (`#/infra/store/useStore`) or a selector. They never call `store.set` on a foreign store (ESLint `sourdaw/no-foreign-store-write`, **warn** — canonical rule in `state-and-write-paths` rule 3); mutations go through the owning module's use cases or `executeAppAction` (`#/modules/Command/useCases`). Leaf components must not import a business store **directly** (**error** `components-no-business-store-access`).

**Why:** global visibility without global mutability keeps undo, CRDT, and invariants in one place.

### 4. Dependency direction is UI → business → IO

```
presentations/  →  useCases/  →  repositories/ | stores/ | services/
                     handlers/ (private; registered for Command)
```

- Business/IO never imports `presentations/` (`business-no-presentations`).
- Only `useCases/` orchestrate `repositories/` (`usecases-only-write-boundary-to-repositories`).
- Repositories never import any module's `useCases|handlers|presentations` (`repositories-no-business`), and avoid foreign stores/events; same-module store access stays a thin adapter.
- Models, events, services, validators, and transformers stay pure (`*-are-pure` / `*-must-stay-pure`).

**Why:** reversing the arrow couples domain logic to React lifecycle and makes RT paths unknowable.

### 5. Leaf components stay dumb; composition shells use barrels

Views and hooks may import foreign contract barrels. Leaf `presentations/components/` and `src/components/` must not reach business stores or useCases **directly** (`components-no-business-store-access`, `components-no-usecase-access`) or **transitively** (`components-no-usecase-transitively`), and must not import views (`components-no-view-access`). Shared UI, app, and routes are contract-barrel-only (`external-module-contracts-only`). Presentation never imports repositories, handlers, or engine: **same-module** via `presentation-no-direct-*` (**error**), **cross-module** private paths via `cross-module-index-only` (**error**).

**Why:** leaf components that own business calls become untestable mini-views and trip the reachability gate.

### 6. Use-case types stay private; one function per file

Never `export type` from `useCases/index.ts` (`no-usecase-type-exports-on-index` on the types cruise), and never combine value and type specifiers in one export declaration — the architecture checker rejects that syntax so the type edge cannot hide. Consumers use `ReturnType`/`Parameters` or payloads via `events/`. Each use-case and repository file exports exactly one function. Handlers stay private under `handlers/`; cross-module access is `get<Module>Handlers` from `useCases/`.

**Why:** type re-exports freeze private shapes; multi-export wrappers become laundering barrels.

### 7. Repositories touch metal; engine does not import repositories

I/O (storage, Web Audio setup, desktop bridge calls) belongs in the module-root `src/modules/<M>/repositories/` layer, including its `Common/` and `Supporting/` namespaces. Nested `useCases/repositories` and `presentations/repositories` folders are not repository layers. Desktop bridge confinement (allowlist, mock rules, `desktop-ipc-only-in-repositories` **error**) is canonical in `desktop-platform` rule 4. The engine receives deps from use cases and never imports repositories (**error** `usecases-only-write-boundary-to-repositories`).

**Why:** engine → repository couples graph/RT code to I/O and breaks the use-case write boundary.

## Anti-patterns

### CRITICAL — Boundary evasion (malicious compliance)

❌ Re-export a repository through a use-case file so the import path is “legal”.

✅ A real typed use case that owns the operation; consumers import the function, not the private symbol.

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — module anatomy, contract barrels, layering.
- `.dependency-cruiser.cjs` + `scripts/check-dependency-boundaries.mjs` — cache-free exact debt ratchet. Run `pnpm deps:validate`.
