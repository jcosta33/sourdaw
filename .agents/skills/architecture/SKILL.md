---
name: architecture
type: agent-guide
description: >-
  Author module code against Sourdaw's DDD boundaries: contract barrels, stores as
  public read contracts, UI → business → IO flow, and composition shells. ALWAYS
  apply when creating modules, moving code between layers, adding cross-module
  imports, wiring use cases or stores, or designing presentation access to other
  domains. Do not invent a fifth barrel, deep-import private folders, or treat
  stores as free global write APIs — apply first. Skip pure styling, single-file
  renames inside one folder, and violation *remediation* tactics (use
  architecture-violations for those).
---

# Skill: Architecture

## Purpose

Modules must stay independently understandable. When the boundary leaks — a presentation
file importing a foreign repository, a use case importing `presentations/`, a model
climbing into the engine — the cost surfaces months later as cascading rewrites and
RT-unsafe paths. This skill is how to **build** on the right side of the boundary.
When a check already failed and you need to fix without gaming the validator, load
`architecture-violations` instead.

## Core rules

### 1. Cross-module imports only through contract-folder barrels

Each module exposes **four** barrels and nothing else:

| Barrel | Role |
|--------|------|
| `#/modules/<M>/useCases` | Callable operations (functions/constants only — no type re-exports) |
| `#/modules/<M>/stores` | **Read** contract for domain/UI working state |
| `#/modules/<M>/events` | Typed cross-module payloads |
| `#/modules/<M>/presentations/views` | View entry points other modules may compose |

There is **no** module-root `index.ts`. Deep imports into contract folders or private
paths (`models/`, `repositories/`, `handlers/`, `engine/`, …) are forbidden
(`cross-module-index-only`, `contract-barrel-scope`).

```typescript
// ✅ other module
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';

// ❌ deep / private
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { type Track } from '#/modules/Arrangement/models/Track';
```

**Why:** the barrel is the curated public surface. A deep import freezes private layout
and lets model changes cascade across modules.

### 2. Same module uses relative imports — never own barrels

Inside `src/modules/Arrangement/`, import with relatives (`../stores/trackStore`,
`./addTrack`). Do not `import { addTrack } from '#/modules/Arrangement/useCases'`.

**Why:** barrels are for **external** consumers. Intra-module barrel use creates cycles,
hides the real file graph, and fights `no-self-barrel-import`.

### 3. Stores are a public **read** contract; writes stay with the owner

Sourdaw **keeps** `stores/` as a contract (unlike kits that privatize stores). Other
modules may subscribe via `useStore` / selectors. They must **not** call `store.set`
on a foreign store — route mutations through the owning module's use cases or
`executeAppAction`.

```typescript
// ✅ read foreign store
import { trackStore } from '#/modules/Arrangement/stores';
import { useStore } from '#/infra/store/useStore';
const tracks = useStore(trackStore);

// ✅ mutate via owner / command bus
import { executeAppAction } from '#/modules/Command/useCases';
await executeAppAction({ type: 'track/add', payload: { … } });
```

**Why:** global **visibility** without global **mutability** keeps undo, CRDT, and
invariants in one place. See `state-and-write-paths`.

### 4. Dependency direction is UI → business → IO

```
presentations/  →  useCases/  →  repositories/ | stores/ | services/
                     handlers/ (private; registered for Command)
```

- Business/IO **must not** import `presentations/` (`business-no-presentations`).
- Only `useCases/` orchestrate `repositories/` (`usecases-only-write-boundary-to-repositories`).
- Repositories must not climb into useCases/handlers/presentations
  (`repositories-no-business`). Same-module `stores/` access is allowed (including
  thin get/set of owned state — e.g. transport/workspace persistence helpers). Multi-step
  orchestration and domain event emission still belong in use cases.

**Why:** reversing the arrow couples domain logic to React lifecycle and makes RT paths
unknowable.

### 5. Presentation composition shells may call foreign useCases and stores

Workspace, Command panels, and device UIs are **composition roots**. Views and hooks may
import foreign **barrels** (`useCases`, `stores`, `events`, `presentations/views`). They
must not import foreign private folders.

Leaf **components** stay dumb — prefer views/hooks for business access. Machine rules:

| Rule | What it actually bans |
|------|------------------------|
| `components-no-usecase-access` | **Same-module** `useCases/` only |
| `components-no-business-store-access` | **Any** module business `stores/` (same or foreign) |
| `components-no-view-access` | **Any** module’s `presentations/views/` |
| `components-no-usecase-transitively` (reachability) | Component that can **reach any** module’s `useCases/` (value graph) |

Foreign useCases from a leaf component are covered by the reachability edge gate
(`scripts/deps-check-reachability.mjs` — full from→to baseline). Foreign **stores** from a
leaf component fail `components-no-business-store-access` directly. Views and hooks keep
the public store read contract.

**Why:** forbidding *all* foreign useCases from **views** would force a wrapper per action
in a DAW shell; forbidding **leaf components** from owning business calls keeps leaves dumb.

### 6. Models and events stay pure; types do not leak through useCases barrels

- `models/` private; never on a barrel (`no-models-repos-transformers-in-index`).
- Consumer modules define **local** shapes or use `ReturnType` / `Parameters` of imported
  functions — not `import type` from another module's useCases. Policy name:
  `no-usecase-type-exports-on-index` (depcruiser only sees type-only edges; without
  `tsPreCompilationDeps: 'specify'` this is **review/skill policy**, not a reliable hard gate).
- Cross-module type payloads live on `events/`.
- Models must not climb into repos/handlers/presentations/engine (`models-are-pure`).
- Events must not import orchestration/IO (`events-are-pure`).

**Why:** duplicated consumer types are intentional; shared model imports hide blast radius
until production.

### 7. One use case / repository function per file; handlers are private

- Use cases and repositories: one exported function per file.
- `handlers/` build `createHandler` maps; not contract. Cross-module only via
  `get<Module>Handlers` on the useCases barrel for Command registration.
- Presentation uses `executeAppAction` or granular use cases — never raw handler maps.

**Why:** multi-export wrapper files become laundering barrels.

### 8. Repositories touch metal; engine does not import repositories

I/O (Tauri, filesystem, Web Audio setup, decode) lives in `repositories/`. The
`engine/` path stays RT-oriented and does not orchestrate repositories directly —
use cases inject or call repos.

**Why:** keeps I/O and RT graphs separable and testable. See `web-audio-engine`,
`tauri-platform`.

## What does not belong

- **How to silence a red `deps:validate`** — that is `architecture-violations` (real fix,
  not gaming).
- **State taxonomy and write-path ownership detail** — `state-and-write-paths`.
- **RT buffer/worklet rules** — `web-audio-engine`.
- **Plugin scan/host lifecycle** — `plugin-hosting`.
- Frontify/GraphQL-specific folder kits (`errors/` as public contract, store privacy).

## Anti-patterns

### CRITICAL — Cross-module private import

❌ `import { Track } from '#/modules/Arrangement/models/Track'`  
✅ Call a use case; keep a local type with only fields you need.

### CRITICAL — Business importing presentations

❌ `useCases/initX.ts` imports `../presentations/renderers/…`  
✅ Keep UI factories under presentations; call them from views/hooks only
(`business-no-presentations`).

### CRITICAL — Boundary evasion (malicious compliance)

❌ Types/constants parked in `useCases/` so a blocked import becomes “legal”; fake use
cases that only re-export repositories; events used as a disguised function call to one
known listener.

✅ Segregate types per module. A use case is a business operation. Duplication of consumer
types is accepted by design. If no legitimate route exists, stop and report the rule.

### HIGH — Component owns business calls or store reads

❌ `presentations/components/Foo.tsx` imports useCases or business stores, or reaches
them via a shared knob that pulls the command bus.

✅ View/hook owns the call/subscription; component receives values and callbacks
(`components-no-usecase-*`, `components-no-business-store-access`).

### HIGH — Foreign store write

❌ `trackStore.set(…)` from Workspace code.

✅ `executeAppAction` / Arrangement use case that owns the write.

### MEDIUM — Same-module barrel import

❌ `import { addTrack } from '#/modules/Arrangement/useCases'` inside Arrangement.

✅ Relative path to the defining file.

## References

- `AGENTS.md` — Frontend Domain-Driven Architecture
- `docs/architecture/03-typescript-module.md` — module anatomy
- `.dependency-cruiser.cjs` / `.dependency-cruiser.reachability.cjs` — machine rules
- `pnpm deps:validate` — both cruises + known-violations baselines  
  (main: edge-level ignore; reachability: **per dirty component `from`**, not per target — see reachability config header)
- `architecture-violations` — fix discipline when a check fails
- `state-and-write-paths` — who may write which state
