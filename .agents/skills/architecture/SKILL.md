---
name: architecture
description: >-
    Author module code against Sourdaw's DDD boundaries: contract barrels, stores as
    public read contracts, UI → business → IO flow, module tiers, and composition
    shells. ALWAYS apply when creating a module, placing code in a layer, adding a
    cross-module import or contract-barrel export, adding a module-to-module
    dependency, or designing presentation access to other domains. Skip state
    classification and choosing a value's owner (state-and-write-paths), document
    write mechanics (crdt-collaboration), violation remediation
    (architecture-violations), pure styling, and single-file renames inside one
    folder.
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

Inside `src/modules/Arrangement/`, import relatively (`../stores/trackStore`, `./addTrack`). Never import your own module's barrels (`no-internal-barrel-import`).

**Why:** barrels serve external consumers; intra-module barrel use creates cycles.

### 3. Stores are a public read contract; writes stay with the owner

Foreign modules read a store by subscribing with `useStore` (`#/infra/store/useStore`) or a selector. They never call `store.set` on a foreign store (ESLint `sourdaw/no-foreign-store-write`, **error**); mutations go through the owning module's use cases or `executeAppAction` (`#/modules/Command/useCases`). The owner itself writes a CRDT-backed store only from its handler or use case while an action's transaction is open — canonical rule in `state-and-write-paths` rule 3. A dispatch a person triggered goes through `executeUserAppAction` from the same barrel (canonical: `ui-patterns` rule 8). Leaf components must not import a business store **directly** (**error** `components-no-business-store-access`).

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

Modules follow the tier order and form no cycle. `.dependency-cruiser.module-tiers.cjs` places every module in a tier and says which tiers it may depend on. The `moduleTiers` gate in `scripts/check-dependency-boundaries.mjs` aggregates every production import, re-export, dynamic `import()` and type-only edge to module pairs, fails an upward cross-module edge, and reports every module-level cycle; edges with presentation code on either end, tests, and `testing/` helpers are outside it. The gate has no baseline: the manifest's `allowedCycles` and `acceptedTierEdges`, each with its reason, are its only accepted rows, and `--write-baseline` refuses it. A module's tier follows its role, never its current imports, so an upward or cyclic edge is either removed or argued in review as a reasoned manifest entry — never fixed by moving a module to the tier its imports want. PR CI runs the gate inside `pnpm deps:validate`, so an upward or cyclic module edge fails there.

**Why:** reversing the arrow couples domain logic to React lifecycle and makes RT paths unknowable. File-level `no-circular` cannot see a cycle that runs through several modules, and a tier changed to fit today's imports erases the layering it encodes.

### 5. Leaf components stay dumb; composition shells use barrels

Views and hooks may import foreign contract barrels. Leaf `presentations/components/` and `src/components/` must not reach business stores or useCases **directly** (`components-no-business-store-access`, `components-no-usecase-access`) or **transitively** (`components-no-usecase-transitively`), must not import presentation stores (`components-no-presentation-store-access`), and must not import views (`components-no-view-access`). Shared UI, app, and routes are contract-barrel-only (`external-module-contracts-only`). Same-module presentation code never imports repositories (`presentation-no-direct-repositories`), handlers (`presentation-no-direct-handlers`), services, validators or transformers (`presentation-no-direct-services-validators-transformers`), or `engine/`, `runtime/`, `worklets/` and `workers/` (`presentation-no-engine-runtime-imports`); cross-module private paths are closed by `cross-module-index-only`. The other direction is closed too: non-presentation code never imports `presentations/stores/` or `presentations/context/`, even inside its own module (`presentation-stores-private-even-intra-module`, `presentation-context-private-even-intra-module`). All are **error**.

**Why:** leaf components that own business calls become untestable mini-views and trip the reachability gate.

### 6. Use-case types stay private; one function per file

Never `export type` from `useCases/index.ts` (`no-usecase-type-exports-on-index`, on the main and types cruises), and never combine value and type specifiers in one export declaration — the architecture checker rejects that syntax so the type edge cannot hide. Consumers use `ReturnType`/`Parameters` or payloads via `events/`. Each use-case and repository file exports exactly one function. Handlers stay private under `handlers/`; cross-module access is `get<Module>Handlers` from `useCases/`.

**Why:** type re-exports freeze private shapes; multi-export wrappers become laundering barrels.

### 7. Repositories touch metal; engine does not import repositories

I/O (storage, Web Audio setup, desktop bridge calls) belongs in the module-root `src/modules/<M>/repositories/` layer. Nested `useCases/repositories` and `presentations/repositories` folders are not repository layers. Desktop bridge confinement (allowlist, mock rules, `desktop-ipc-only-in-repositories` **error**) is canonical in `desktop-platform` rule 4. The engine receives deps from use cases and never imports repositories (**error** `usecases-only-write-boundary-to-repositories`).

**Why:** engine → repository couples graph/RT code to I/O and breaks the use-case write boundary.

## Anti-patterns

### CRITICAL — Boundary evasion (malicious compliance)

❌ Re-export a repository through a use-case file so the import path is “legal”.

✅ A real typed use case that owns the operation; consumers import the function, not the private symbol.

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — module anatomy, contract barrels, layering.
- `.dependency-cruiser.cjs` + `scripts/check-dependency-boundaries.mjs` — cache-free exact debt ratchet. PR CI runs `pnpm deps:validate`; inspect that result after cross-module changes.
- `.dependency-cruiser.module-tiers.cjs` — module tier manifest, `allowedCycles` and `acceptedTierEdges` for the `moduleTiers` gate; rules in [docs/architecture/03-typescript-module.md §7.5](../../../docs/architecture/03-typescript-module.md#75-module-tiers).
