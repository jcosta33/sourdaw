# TypeScript Module Architecture

This document defines the **TypeScript-side module architecture** for the DAW.

It explains:

- what a module is
- which architectural concepts exist
- what each concept is responsible for
- which folders are public contracts vs private internals
- what a normal module should look like
- how modules interact
- how to structure code without turning the repo into ceremony theater

This document is the source of truth for **TypeScript module anatomy and dependency direction**.

It complements:

- `DAW System Architecture` — system-level invariants and runtime model
- `Rust Backend Architecture` — native/backend topology

---

## 1. What a module is

A **module** is a **DDD bounded context / ownership boundary**.

A module is **not** just a user-facing feature.
A module is the unit that owns:

- a slice of business truth
- the invariants around that truth
- the public useCases that may mutate that truth
- the internal implementation details needed to support that ownership

### Good examples of modules

```text
Arrangement
Transport
Routing
Automation
PluginHost
Project
MIDI
Command
```

These are ownership boundaries, not just UI sections.

### A feature is different from a module

A **feature** is a user-facing capability that may span multiple modules.

Example:

```text
Feature: recording
May involve:
- Transport
- Arrangement
- Routing
- AudioEngine
- Project
```

So:

- **module** = architectural ownership boundary
- **feature** = product capability

This architecture is organized around **modules**, not feature slices.

---

## 2. The dependency model in one picture

```text
presentations/views
presentations/hooks
presentations/context
presentations/stores
presentations/renderers
        │
        ▼
useCases
        │
        ├──────────────► validators
        ├──────────────► services
        ├──────────────► transformers
        ├──────────────► repositories / adapters
        ├──────────────► stores (business-layer)
        └──────────────► events / errors
                         │
                         ▼
                      models

Cross-module access is narrow:
- other modules import only from the contract-folder barrels the target module exposes (up to four — see §3.3)
- private internals stay private
```

---

## 3. Module anatomy

A TypeScript module is composed of a **public contract surface** and **private internals**.

## 3.1 Public contract surface

Each module may expose **up to four** independently-importable contract surfaces — create only those it actually needs. Other modules target exactly one of these per import:

```text
<module>/useCases/index.ts
<module>/events/index.ts
<module>/stores/index.ts
<module>/presentations/views/index.ts
```

`errors/` stays internal. Cross-module **named types** surface through **`events/index.ts`** or as a **local duplicate** in the consumer — not via `export type` from `useCases/`.

### Contract folder roles

| Contract folder        | Role                              | Import target                                                                                                                          |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `useCases/`            | public write boundary (functions) | `#/modules/<M>/useCases` — `export { fn }` only, **no** `export type` from `useCases/`. Includes **`get<Module>Handlers`** (see §4.5). |
| `events/`              | domain event payload types        | `#/modules/<M>/events` — `export type` / values as needed                                                                              |
| `stores/`              | shared business/read state        | `#/modules/<M>/stores`                                                                                                                 |
| `presentations/views/` | composable UI entry points        | `#/modules/<M>/presentations/views`                                                                                                    |

Modules with no events do not need an `events/index.ts`. Modules with no cross-module views do not need a `presentations/views/index.ts`.

## 3.2 Private internals

These are implementation details and may change freely inside the module.

```text
handlers/
models/
validators/
services/
repositories/
transformers/
presentations/hooks/
presentations/stores/
presentations/context/
presentations/components/
presentations/renderers/
engine/
worklets/
runtime/
```

`handlers/` holds `AppAction` → `ActionHandler` maps; it is **never** importable cross-module (see §4.5). Access cross-module only via **`get<Module>Handlers`** use cases.

These are private unless explicitly promoted to a contract-folder barrel.

## 3.3 Module boundaries — contract-folder barrels

No module has a root `index.ts`. Each module exposes up to four `<contract-folder>/index.ts` files. Each barrel is self-contained: it re-exports only from files within its own folder.

```text
ModuleName/
  useCases/
    index.ts        ← re-exports from useCases/** only
    addTrack.ts
    ...
  stores/
    index.ts        ← re-exports from stores/** only
    trackStore.ts
    ...
  events/
    index.ts        ← re-exports from events/** only (if module emits events)
    ...
  presentations/
    views/
      index.ts      ← re-exports from presentations/views/** only (if views cross modules)
      ...
  models/           ← private
  repositories/     ← private
  ...
```

### Rules

1. **Cross-module imports must target a contract-folder barrel** — `<module>/useCases`, `<module>/stores`, `<module>/events`, or `<module>/presentations/views`. Importing any other path from outside the module is forbidden.
2. **Each `<contract>/index.ts` re-exports only from its own folder** — `useCases/index.ts` must not import from `stores/`, `models/`, `repositories/`, or any other folder. `stores/index.ts` must not import from `useCases/`. Each barrel is self-contained.
3. **No module-root `index.ts`** — the aggregated root barrel pattern is retired. Do not add a `<module>/index.ts` or `<module>/contract.ts` aggregation shim.
4. **Same module — never import from own contract barrels** — files inside `src/modules/<M>/` must **not** import from `#/modules/<M>/useCases`, `#/modules/<M>/stores`, etc. Use **relative** imports to the implementation (`./useCases/…`, `../stores/…`, etc.).
5. **No use-case types cross the boundary** — `useCases/index.ts` may re-export **functions** (and constants) from `useCases/`, not `export type { … }`. Other modules define their own types or use `ReturnType` / `Parameters`. **Typed event payloads** from `events/index.ts` are the canonical cross-module type surface.
6. **Curate each barrel for cross-module need only** — export from `<contract>/index.ts` only symbols that **another module** actually consumes. Most files in a module do not appear in any barrel.

### Why four contract-folder barrels instead of one root barrel

The root `index.ts` pattern was retired because ES module re-exports are not lazy: `import { oneStore } from ‘#/modules/Arrangement’` evaluates all 200+ exports in the root barrel, including every use-case transitive dependency. This made the blast radius of any single import equal to the entire module’s transitive closure, creating circular-dependency exposure and `inject()` TDZ crashes.

Four smaller barrels break this amplification: importing from `stores/index.ts` only evaluates stores and their transitive dependencies (models, storage adapters). It does not evaluate use cases, views, or their deps. Each barrel is independently narrow.

### Example

```ts
// Another module — correct
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import type { TrackAddedPayload } from '#/modules/Arrangement/events';
import { ArrangementBar } from '#/modules/Arrangement/presentations/views';

// Another module — FORBIDDEN (direct file access)
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
```

```ts
// src/modules/Arrangement/useCases/index.ts — curated useCases barrel
export { addTrack } from './addTrack';
export { removeTrack } from './removeTrack';
export { getArrangementHandlers } from './getArrangementHandlers';
// FORBIDDEN inside useCases/index.ts:
// export type { TrackSummary } from './getTrackSummary'; // use-case types stay private
// export { trackStore } from '../stores/trackStore';     // wrong folder
```

```ts
// Inside Arrangement — correct (relative)
import { trackStore } from '../stores/trackStore';
import { addClip } from './useCases/clip/addClip';

// Inside Arrangement — FORBIDDEN (own contract barrel)
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip } from '#/modules/Arrangement/useCases';
```

---

## 4. Core architectural concepts

This section defines the actual concepts agents need to understand.

## 4.1 `models/`

**Models** are plain business types.

They describe:

- shapes
- domain data
- value objects
- discriminated unions
- configuration objects

They do **not** own behavior through class methods in normal TypeScript module architecture.

### Good

```typescript
export type Track = {
    id: TrackId;
    name: string;
    gainDb: number;
    pan: number;
    isMuted: boolean;
};
```

### Bad

```typescript
class Track {
    mute() {}
    setPan() {}
    serialize() {}
    connectToEngine() {}
}
```

Why bad:

- mixes data and behavior
- complicates serialization
- encourages leaking runtime concerns into domain types

### Models should be

- serializable when part of project truth
- framework-free
- runtime-handle-free
- easy to diff, clone, and persist

### Model isolation across modules

Models must never cross module boundaries — not via direct import, not via re-export through `useCases/` or any other folder.

If module B needs data that resembles module A's model, module B defines its own local type with only the fields it uses. That duplication is intentional. The structural match at a use-case boundary is implicit — a contract break shows up as a compile error at the call site, not as a shared import drifting silently across the codebase.

This applies to constants defined in `models/` as well. Opaque identifiers like document IDs or string sentinels that live in one module's `models/` file must be inlined in any consuming module rather than imported.

---

## 4.2 `errors/`

**Errors** define meaningful failure cases at the module boundary.

Use them for:

- missing entities
- invalid operations
- invariant violations
- public action failures

### Good examples

```text
TrackNotFoundError
ClipOverlapError
RoutingCycleError
ProjectLoadError
```

### Rules

- `errors/` is **module-private** (not a contract barrel — do not import cross-module)
- domain errors stay in the owning module; surface failures via use-case results/events as designed
- errors should be meaningful at the boundary where they surface

---

## 4.3 `events/`

**Events** represent meaningful business occurrences.

Events are not just value changes.
They are used when another concern needs to react independently.

### Good examples

```text
TrackAddedEvent
ClipMovedEvent
TempoChangedEvent
PluginAddedEvent
```

### Use events when

- another module needs to react
- the occurrence has business meaning
- the occurrence matters for logging/history/collaboration/integration

### Do not use events for

- every tiny field mutation
- avoiding ownership decisions
- replacing explicit use-case calls when a direct dependency is cleaner

---

## 4.4 `useCases/`

This is the **public write boundary**.

A use case/action/command:

- expresses user or system intent
- validates input
- enforces module rules
- updates authoritative state
- emits meaningful events where appropriate
- calls repositories/adapters when I/O is needed

This is where meaningful writes begin.

### Good example

```typescript
export const moveClip = (input: MoveClipInput): void => {
  const state = projectStore.value!;
  const clip = state.arrangement.clips.find((item) => item.id === input.clipId);

  if (!clip) {
    throw new ClipNotFoundError(input.clipId);
  }

  validateClipPlacement(...);

  projectStore.set(...);

  void eventBus.emit('clip.moved', { clipId: input.clipId });
};
```

### Use cases must not

- call React hooks
- own rendering logic
- directly contain browser/desktop I/O if that I/O belongs in a repository/adapter
- become generic dumping grounds for unrelated helper logic

### One function per file

Each use case file should export exactly **one** public operation.

Good:

```text
useCases/
  addTrack.ts
  removeTrack.ts
  moveClip.ts
  splitClip.ts
```

Bad:

```text
useCases/
  trackActions.ts   // 900 lines, 14 exported use cases
```

### Use cases are a behavioral contract, not a shared type surface

A use case file must export its own typed function — never a pure re-export of a repository function. A file that only does `export { getX } from '../repositories/Y'` creates no real boundary; it launders private access through a fake public path. The **runtime behavior and function entry point** are what other modules may import; **types defined in `useCases/` stay inside the module** (including DTOs and aliases used to implement the function). Other modules do not `import type` from another module’s `useCases/` or from `useCases/index.ts` re-exports of those types — they keep **local types** or derive shapes with `ReturnType<typeof fn>` / `Parameters<typeof fn>` when calling an imported function.

When a repository returns something that is not a pure model, the use case still defines internal types for mapping — those types are not part of the cross-module export surface.

Cross-module **named types** for events belong in **`events/`** and may be re-exported from the `events/index.ts` barrel like any other event payload contract.

See the `architecture-violations` skill (§6) for detailed rules and examples.

### What a use case file may and may not export

A use case file is a behavioural contract. It exports a single function (rule: **one function per file**), and it may export the **local types** that describe that function's surface (e.g. its `Input` / `Output` aliases, an internal DTO it produces). Those local types are intra-module by default.

What a use case file **must never** export, under any circumstance:

- **Model types or model values** — anything that lives in `models/`. Models are private to the owning module and never cross any other folder. A use case re-exporting a model type (`export type { Track } from '../models/Track'`) launders the private boundary through a fake public path. If a use case needs to expose data shaped like a model, it defines its **own local DTO** with only the fields the contract requires.
- **Repository types or repository values** — anything from `repositories/`. Repositories are I/O internals. Pure re-exports like `export { saveX } from '../repositories/...'` are forbidden (§6.2 of the `architecture-violations` skill); the same rule applies to `export type`.
- **Types from `services/`, `validators/`, `transformers/`, `engine/`, `errors/`** — these folders are private. Their types do not cross the module boundary in any form, including via a use case file.

Acceptable type exports from a module's public surface:

| Type origin                                                                                                | Cross-module export?                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events/` event payloads                                                                                   | **Yes.** Re-export via the `events/index.ts` barrel as `export type { FooEvent } from './...'`. This is the canonical shared-type surface across modules.                                                                                                                                                                                                |
| `stores/` store value types                                                                                | **Yes.** A `Store<T>` instance is part of the public contract; the `T` shape is naturally part of that. Re-export the store's value type via the `stores/index.ts` barrel if needed.                                                                                                                                                                     |
| `useCases/` local types                                                                                    | **Intra-module only.** The `useCases/index.ts` barrel re-exports functions and constants only — never `export type` (`no-usecase-type-exports-on-index`). Other modules use `ReturnType<typeof fn>` / `Parameters<typeof fn>` or define a local shape. If a use-case input/output type genuinely must be shared cross-module, model it as a typed payload in `events/` (exported via `events/index.ts`) — never a deep import of `#/modules/<X>/useCases/...`. |
| `models/`, `repositories/`, `services/`, `validators/`, `transformers/`, `engine/`, `errors/`, `handlers/` | **Never.** Not from any contract barrel, not from a use case file, not from anywhere.                                                                                                                                                                                                                                                                    |

The hard rule: **cross-module type consumption goes through `events/index.ts` (typed payloads), or through `ReturnType` / `Parameters` / a local shape on the consumer — or it does not happen.** A use case file is allowed to declare and export types that describe its own contract, but it is never a back door for promoting model, repository, or other private types to a cross-module surface, and `useCases/index.ts` never re-exports them.

---

## 4.5 `handlers/` — `AppAction` handler maps (non-contract)

**Handler maps** wire `AppAction` discriminant types to `ActionHandler` (`execute`, `describe`, `undoable`) for `executeAppAction`. They **orchestrate** granular use cases (often across modules) and own undo **description** for the command layer.

This layer is **not** part of the general cross-module contract. Other feature modules must **not** import `trackHandlers`-style maps from peers.

### Placement

- Prefer **`handlers/`** at the module root (same depth as `useCases/`). Until migration, legacy `useCases/*Handlers.ts` files are acceptable; new work should use `handlers/`.
- **`handlers/` is private** — it is **not** re-exported from any contract barrel. Dependency-cruiser treats it like other internals.

### Construction

- Each **`ActionHandler`** is created **in the handler module**, not in `get<Module>Handlers`. Typical shape: **`export const handleMuteTrack = createHandler<'muteTrack'>({ … })`** (or **`export const handleMuteTrack = () => createHandler<'muteTrack'>({ … })`** when a factory is needed). Import **`createHandler`** from **`#/utils/createHandler`**.
- **`get<Module>Handlers`** merges pre-built handler maps (and may `spread` domain maps such as `clipHandlers.ts` that only re-export already-built `createHandler` entries). It does **not** call `createHandler` itself. Intermediate aggregate maps under `handlers/` are allowed when they only compose handler modules — they are still private (not on a contract barrel).

### Cross-module access

- Only **`get<Module>Handlers`** **use cases** in `useCases/` merge handler maps for **Command**. Return **`Record<string, ActionHandler<any>>`** only when the domain is open-ended; for a **fixed** set of `AppAction` discriminants, prefer a **domain map type** derived from `AppAction` (union of `Extract<AppAction, { type: '…' }>` plus `{ [Action in … as Action['type']]: ActionHandler<Action> }`) so each key stays tied to its payload type. They perform **no** `createHandler` calls — only object spread of maps exported from handler modules.
- Presentation and other domains **do not** import handler maps; they dispatch **`executeAppAction`** or call granular use cases.

---

## 4.6 `stores/`

`stores/` are **business-layer stores**, not presentation-layer stores.

They expose:

- project truth
- shared runtime visibility
- shared read state that must be visible across modules

These are part of the public module contract.

### Good uses

- `projectStore`
- `transportStore`
- `engineStatusStore`
- `midiDevicesStore`

### Bad uses

- local hover state
- panel open state
- temporary drag state
- component-local drafts
- storing runtime handles like `AudioNode`

### Key rule

A business-layer store may be globally readable.
That does **not** mean it is globally writable.

Meaningful writes still go through public use cases.

---

## 4.7 `validators/`

Validators enforce invariants.

They are pure functions that check whether an operation is valid.

Use validators for:

- overlap rules
- cycle detection
- range/placement checks
- aggregate consistency rules

### Good example

```typescript
export const validateClipPlacement = (...) => {
  if (overlapsExistingClip) {
    throw new ClipOverlapError(...);
  }
};
```

### Validators should be

- pure
- module-private
- reusable across multiple use cases in the same module

Validators are not a public contract.

---

## 4.8 `services/`

Services contain stateless business logic that spans multiple entities or concepts but does not belong in one use case.

Use services for:

- automation interpolation
- latency compensation calculations
- routing graph algorithms
- clip quantization logic
- timeline calculations

### Good example

```typescript
export const interpolateAutomation = (...) => {
  ...
};
```

### Services should be

- stateless
- pure unless clearly documented otherwise
- module-private by default

Services are not generic “helpers.”

---

## 4.9 `repositories/`

Repositories are the **I/O layer**.

They are thin adapters between business logic and the outside world.

A repository may access:

- Web Audio API
- localStorage / IndexedDB
- fetch / WebSocket
- `desktopInvoke` / `desktopListen`
- filesystem APIs
- third-party libraries with side effects
- plugin host bridges
- MIDI APIs

### Good repository behavior

- translate inputs/outputs
- call external APIs
- remain thin
- contain no business workflow logic

### Good example

```typescript
export const saveProjectToStorage = (data: ProjectState): void => {
    localStorage.setItem('project', JSON.stringify(data));
};
```

### Repositories must not

- emit business events
- coordinate undo/redo
- own multi-step workflows
- mutate authoritative business truth as their main job
- call React code

### One function per file

Each repository file should export exactly one function.

---

## 4.10 `transformers/`

Transformers are pure mapping functions between representations.

Use them to map:

- domain models to engine configs
- domain models to DTOs
- Rust/native payloads to TS models
- serialized payloads to internal shapes

### Good example

```typescript
export const transformTrackToEngineConfig = (track: Track): TrackEngineConfig => ({
    id: track.id,
    gainLinear: dbToLinear(track.gainDb),
    pan: track.pan,
});
```

Transformers should be:

- pure
- side-effect-free
- **module-private. Always.** Transformers never cross module boundaries — not via direct import, not via re-export through `useCases/`, `index.ts`, or any other folder. If module B finds itself reaching for a transformer in module A, the answer is one of: (1) module B owns its own transformer with its own shape, (2) the work belongs in a use case in module A that module B calls, or (3) the symbol was misclassified — it is not a transformer at all and belongs in `services/` or as a use case. "Sharing" a transformer is the signal that the design is wrong.
- consumed only by use cases (and other intra-module transformers/services). **Presentation must never import transformers, services, validators, or repositories.** Hooks/views may consume **useCases** and **store barrels**; leaf components prefer props from views/hooks.

Transformers are not mini-services with hidden behavior, and they are not a public API. The same rule applies to `services/` and `validators/`: pure, intra-module, called only by use cases (or by other services in the same module).

---

## 4.11 Dependency injection with `inject()`

Use cases and other injectable functions declare their dependencies explicitly using `inject()` from `#/infra/di/inject`. This is the canonical DI mechanism for the business layer.

### Why `inject()`

Use cases and service repositories get collaborators only through **`inject(deps)(factory)`**: declare dependencies as a map in the first call; the factory receives them and returns the public function. Resolution happens **at call time** (not import time). Tests substitute deps with **`injectDependencies()`** from `#/infra/di/testing/injectDependencies`.

Do not wire **varying** collaborators by **`Container.get()`** at module scope. Prefer **`inject()`** for event buses, loggers, and other mockable services. Thin same-module repository functions that only read/write the owned store may stay as static imports (common in Arrangement) — see the `addTrack` sample below and `docs/01-dependency-injection.md`.

### Shape

```typescript
// Real shape (Arrangement/useCases/addTrack.ts): inject collaborators that vary in tests;
// pure repos may stay static imports when they are thin store accessors.
import { inject } from '#/infra/di/inject';
import { createTrack as createTrackModel } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { ArrangementEventBus } from './arrangementEventBus';

type AddTrackInput = { name: string; kind: TrackKind; select?: boolean };

export const addTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function addTrack(input: AddTrackInput): Track | null {
            const state = getTrackState();
            if (!state) {
                return null;
            }
            const track = createTrackModel(input);
            setTrackState({
                ...state,
                tracks: [...state.tracks, track],
                selectedTrackId: input.select === false ? state.selectedTrackId : track.id,
            });
            void eventBus.emit('track.added', { trackId: track.id, name: track.name, kind: track.kind });
            return track;
        }
);
```

At call time, `addTrack(input)` resolves each dependency in the map and invokes the factory. The caller writes `addTrack(input)` — they do not see or touch the dependency map.

**The factory must return a function** (the invoker). The curried API is `inject(deps)(factory)` — the first call takes the dependency map, the second takes the factory. Objects/services flow into the injectable via the dependency map, not as the factory's return.

### Dependency map values

The dependency map accepts three kinds of values:

| Value                                            | Resolution                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A class (e.g. `EventBus`)                        | Looked up via `Container.get(Class)`                                                                                                    |
| Another injectable (from `inject(...)`)          | Recursively resolved — the injectable's factory is invoked with its own deps, and the resulting function is passed to the outer factory |
| Anything else (plain function, object, constant) | Used as-is, no container lookup                                                                                                         |

Classes resolve to their registered instance in the container. Injectables resolve to their invoker function. Plain values pass through.

### Resolution semantics

- **Memoized.** The first call to an injectable resolves its dependencies and calls the factory exactly once. The invoker is cached on the `Container` keyed by the injectable's token. Subsequent calls are a direct function invocation — no re-walk.
- **Cache reset on `Container.clear()`.** Test setup (`injectDependencies`) relies on this: it clears the container before registering mocks, so the next invocation re-resolves against the fresh mocks.
- **Circular dependencies throw with a chain.** `A → B → A` fails at first invocation with the full chain in the message. Break the cycle by introducing an event or restructuring.
- **Async dependencies are forbidden.** If any value in the dependency map is a Promise, the injectable throws during dependency resolution on its first invocation. Resolve async modules before passing them in (typically in bootstrap). This is a deliberate constraint — keeps resolution sync and fast.

### What to wrap with `inject()`

| Layer                                  | Wrap?   | Why                                                                      |
| -------------------------------------- | ------- | ------------------------------------------------------------------------ |
| Use cases                              | **Yes** | Orchestrate repos/services, need to be mockable                          |
| Event subscribers                      | **Yes** | Need the EventBus + a service chain                                      |
| Repositories with service dependencies | **Yes** | Logger, EventBus, desktop bridge shims                                   |
| Pure transformers                      | No      | Pure functions need nothing from the container                           |
| Validators / services (no I/O)         | No      | Pure functions                                                           |
| Models                                 | No      | Data                                                                     |
| React hooks / views                    | No      | Stay in presentation; hooks/views may read store barrels; leaf components get props |
| Engine classes (`TrackNode`, etc.)     | No      | Constructor-injected (pass `AudioContext` as an arg)                     |
| Audio-thread / hot-path code           | **No**  | The resolution + cached invocation has a cost; hot paths must not pay it |

If a function has no outbound side-effect dependencies, it does not need `inject()`. Wrapping pure code adds ceremony without benefit.

### Bootstrap discipline

App singletons are wired from **`src/app/registerDependencies.ts`** (imported early from **`src/app/bootstrap.ts`**). Module event buses often register themselves (e.g. `ArrangementEventBus` + `Container.set`). The rules:

- **Register app-level tokens before use cases run** (logger, root event bus, etc.) via the real `register` / `Container.set` paths used in this repo.
- **Injectables self-register.** Don't hand-register an injectable's token in bootstrap; the resolver does it lazily on first call.
- **Never call `Container.get()` at module top-level.** If you need a value from the container outside a function body, wrap the surrounding function with `inject()` instead.

### Strict mode

In dev and test, `Container.get()` throws if the token is not registered. In production it currently falls back to a lazy Proxy with a `console.warn` (legacy behaviour for code-split chunks that evaluate before bootstrap). As the codebase migrates to `inject()`, the production fallback will be retired.

### Testing injectables

In tests, call `injectDependencies(injectable, mocks)` from `#/infra/di/testing/injectDependencies` to register a complete mock for every dependency. Use `spy<T>()` from `#/infra/di/testing/spy` to build typed method-level spies. See `docs/06-testing.md §5` for the canonical test shape.

---

## 4.12 `presentations/`

This is the UI-facing layer inside a module.

It contains view logic and rendering support, not core business logic.

It usually contains these subfolders:

```text
presentations/
  hooks/
  stores/
  context/
  components/
  renderers/
  views/
```

### `presentations/views/`

This is the public UI composition surface.

Views are the module’s composable UI entry points.

Good examples:

```text
ArrangementView
TransportBarView
PluginRackView
MixerConsoleView
```

Other modules consume **promoted** views only via that module’s **`presentations/views/index.ts`** barrel — never by importing a `presentations/views/` file directly from outside the module.

### `presentations/hooks/`

Hooks connect views to:

- stores
- projections
- selectors
- use cases
- telemetry
- refs

Hooks are private to the module unless explicitly promoted.

Hooks must not become the module’s real business layer.

### `presentations/stores/`

These are presentation-layer stores only.

Use them for:

- persistent UI preferences
- view-local non-business state that should survive refresh
- module-private visual/editor settings

Examples:

- zoom preference
- panel layout preference
- lane height preference

These are **private** and must not be imported cross-module.

### `presentations/context/`

Use for ephemeral view-scoped interaction state.

Examples:

- selected item
- active tool
- scroll position
- drag state

Contexts are module-private and view-scoped.

### `presentations/components/`

Private reusable UI pieces.

Examples:

- `TrackRow`
- `MuteButton`
- `PluginSlot`
- `TimelineHeader`

These are not a public cross-module contract by default.

### `presentations/renderers/`

Renderers are presentation-layer I/O.

Use them for:

- Canvas drawing
- WebGL/WebGPU drawing
- waveform rendering
- meters
- automation curves
- timeline grids
- spectrograms

They should receive precomputed data and draw it.
They should not become business logic containers.

---

## 5. Public vs private folders

## 5.1 The public surface

The only files other modules may import from are a module's **contract-folder barrels** — `useCases/index.ts`, `events/index.ts`, `stores/index.ts`, and `presentations/views/index.ts`. There is **no module-root `index.ts`** (see §3.3).

Symbols on a contract barrel are the **cross-module** contract: export only what **other** modules may import. Files inside the module do not use these barrels — they import implementation files with **relative** paths (see §3.3 rule 4).

Each contract barrel re-exports only from files **within its own folder**:

```text
useCases/index.ts            → business operations (functions only — not use-case type exports)
events/index.ts              → typed domain event payloads
stores/index.ts              → shared business-layer state
presentations/views/index.ts → composable UI entry points (cross-module only via this barrel)
```

## 5.2 Private folders

Everything else is private. No other module may **directly** import paths under:

```text
models/
errors/
validators/
services/
repositories/
transformers/
presentations/hooks/
presentations/stores/
presentations/context/
presentations/components/
presentations/renderers/
presentations/views/   ← use the owning module's presentations/views barrel instead
engine/
runtime/
worklets/
```

If a type must be shared cross-module, prefer **`events/`** (payload types) or consumers’ **local types**. Do not re-export types from `useCases/` on its barrel (`no-usecase-type-exports-on-index`). Keep value and type exports in separate declarations: mixed `export { fn, type Input }` syntax hides the type edge from dependency-cruiser and is rejected by the architecture checker. Views that are part of the public contract are re-exported from the `presentations/views/index.ts` barrel as above.

---

## 6. Dependency direction

Here is the intended dependency direction inside a module.

```text
presentations/views
  -> presentations/hooks
  -> useCases
  -> stores
  -> presentations/context
  -> presentations/components
  -> presentations/renderers

presentations/hooks
  -> useCases
  -> stores
  -> presentations/context
  -> presentations/renderers

useCases
  -> models
  -> validators
  -> services
  -> repositories
  -> transformers
  -> stores
  -> errors
  -> events

repositories
  -> external APIs / metal (desktop bridge, FS, decode, …)
  -> same-module models, transformers, services, stores (read/write of owned store state is common)
  -> shared helpers/types if truly generic
  -> NOT useCases, handlers, presentations, events, or foreign module stores/contracts

validators
  -> models
  -> errors

services
  -> models
  -> shared pure logic if truly generic

transformers
  -> models
  -> DTO/config types
```

### Simplified rule

```text
presentation -> use cases -> repositories / stores / validators / services
```

Never the reverse.

---

## 7. Cross-module interaction patterns

Modules should communicate through a narrow set of approved patterns. All of them go through the target module’s **contract-folder barrels** (`useCases`/`stores`/`events`/`presentations/views`) — never a module-root `index.ts`, which no longer exists.

## 7.1 Pattern A: direct use-case call

Use when:

- another module needs a synchronous business operation
- a return value matters
- the dependency is intentional and acceptable

```typescript
// Import from the module's useCases barrel, not from a useCases/ file directly
import { getRoutingForTrack } from '#/modules/Routing/useCases';
```

## 7.2 Pattern B: event-driven interaction

Use when:

- another concern should react independently
- the emitter should not care who reacts
- the occurrence has business meaning

```typescript
void eventBus.emit('track.added', { trackId, name, kind });
```

## 7.3 Pattern C: shared store / selector read

Use when:

- presentation or read-side logic needs another module’s state
- no write is required
- the read is stable and intentional

```typescript
// Store exported from the module's stores barrel
import { transportStore } from '#/modules/Transport/stores';
const transport = transportStore.value;
```

## 7.4 Pattern D: view composition

Use when:

- one module includes another module’s UI entry point
- the dependency is presentational, not business-layer

```typescript
// Views re-exported from the module's presentations/views barrel
import { ArrangementView } from '#/modules/Arrangement/presentations/views';
```

---

## 8. Canonical module shapes

These are examples, not laws.

## 8.1 Small module

Use when:

- logic is modest
- ownership is simple
- little infrastructure exists

```text
Module/
  models/
  useCases/
  stores/
  presentations/
    hooks/
    views/
```

## 8.2 Standard module

Use when:

- there is real business logic
- there are invariants
- there is I/O
- there is at least one projection or shared store

```text
Module/
  models/
  errors/
  events/
  useCases/
  stores/
  validators/
  services/
  repositories/
  transformers/
  presentations/
    hooks/
    context/
    components/
    views/
```

## 8.3 Runtime-heavy module

Use when:

- engine/runtime integration is significant
- worklets or native/runtime code is involved
- telemetry/reconciliation is involved

```text
Module/
  models/
  errors/
  events/
  useCases/
  stores/
  validators/
  services/
  repositories/
  transformers/
  engine/
  worklets/
  runtime/
  presentations/
    hooks/
    renderers/
    views/
```

## 8.4 Presentation-only module

Use when:

- there is no independent business logic
- the module is a UI view over other modules’ truth

```text
Module/
  presentations/
    hooks/
    context/
    components/
    renderers/
    views/
```

Example: `MixerConsole` is often presentation-only if it reads from Arrangement + Routing + Telemetry rather than owning its own truth.

---

## 9. What goes where: quick lookup table

| Problem                                         | Put it in                  |
| ----------------------------------------------- | -------------------------- |
| Shape of a clip, track, marker, plugin instance | `models/`                  |
| “This clip cannot overlap another”              | `validators/`              |
| “Calculate automation interpolation”            | `services/`                |
| “Save this to localStorage”                     | `repositories/`            |
| “Map Track to engine config”                    | `transformers/`            |
| “Move clip and emit event”                      | `useCases/`                |
| “Shared app-visible transport state”            | `stores/`                  |
| “Selected clip in one view subtree”             | `presentations/context/`   |
| “User zoom preference”                          | `presentations/stores/`    |
| “Waveform canvas drawing”                       | `presentations/renderers/` |
| “Composable UI entry point”                     | `presentations/views/`     |

---

## 10. Example module: standard

```text
Arrangement/
├── __tests__/
├── models/
│   ├── Track.ts
│   ├── Clip.ts
│   ├── Marker.ts
│   └── TempoMap.ts
├── errors/
│   ├── TrackNotFoundError.ts
│   └── ClipOverlapError.ts
├── events/
│   ├── TrackAddedEvent.ts
│   └── ClipMovedEvent.ts
├── useCases/
│   ├── __tests__/                    # Vitest: one spec per use case file
│   │   ├── addTrack.spec.ts
│   │   └── removeTrack.spec.ts
│   ├── addTrack.ts
│   ├── removeTrack.ts
│   ├── addClip.ts
│   ├── moveClip.ts
│   └── splitClip.ts
├── stores/
│   └── arrangementStore.ts
├── validators/
│   └── validateClipPlacement.ts
├── services/
│   └── calculateClipBounds.ts
├── repositories/
│   ├── getWaveformPeaks.ts
│   └── setTrackGainInEngine.ts
├── transformers/
│   └── transformTrackToEngineConfig.ts
└── presentations/
    ├── hooks/
    │   ├── useTracks.ts
    │   └── useMoveClip.ts
    ├── context/
    │   └── ArrangementContext.tsx
    ├── components/
    │   ├── TrackRow.tsx
    │   └── ClipBlock.tsx
    ├── renderers/
    │   └── waveformRenderer.ts
    └── views/
        └── ArrangementView.tsx
```

---

## 11. Example module: runtime-heavy

```text
AudioEngine/
├── models/
│   ├── AudioGraphDescription.ts
│   └── EngineStatus.ts
├── errors/
│   ├── AudioEngineNotReadyError.ts
│   └── AudioContextSuspendedError.ts
├── events/
│   ├── EngineStartedEvent.ts
│   └── EngineStoppedEvent.ts
├── useCases/
│   ├── initializeEngine.ts
│   ├── startEngine.ts
│   └── getEngineStatus.ts
├── stores/
│   └── engineStatusStore.ts
├── repositories/
│   ├── createWebAudioEngine.ts
│   └── createDesktopEngineAdapter.ts
├── engine/
│   ├── AudioEngine.ts
│   ├── TrackNode.ts
│   └── MixerNode.ts
├── worklets/
│   ├── meter-processor.ts
│   └── transport-processor.ts
└── presentations/
    ├── hooks/
    │   └── useEngineStatus.ts
    └── views/
        └── EngineStatusView.tsx
```

---

## 12. Store usage rules

## 12.1 Business-layer `stores/`

These are public and cross-module readable.

Use for:

- project truth
- shared runtime state
- other shared read state that belongs at module level

Do not use for:

- local UI preferences
- hover state
- temporary selection unless it is genuinely module-wide business/UI state

## 12.2 Presentation-layer `presentations/stores/`

These are private.

Use for:

- UI preferences
- view/editor settings
- non-business visual state that must survive refresh

Do not expose these cross-module.

## 12.3 Store rule in one sentence

```text
Business stores are contracts.
Presentation stores are implementation details.
```

---

## 13. Repositories vs use cases in one picture

```text
useCase:
  "what does the app want to do?"

repository:
  "how do we talk to the outside world to do it?"
```

### Good split

```typescript
// useCases/saveProject.ts
export const saveProject = (): void => {
    const state = projectStore.value!;
    validateProjectBeforeSave(state);
    saveProjectToStorage(state);
    void eventBus.emit('project.saved', { projectId: state.id });
};

// repositories/saveProjectToStorage.ts
export const saveProjectToStorage = (state: ProjectState): void => {
    localStorage.setItem('project', JSON.stringify(state));
};
```

### Bad split

```typescript
// repositories/saveProject.ts
export const saveProject = (): void => {
  validateProjectBeforeSave(...);
  projectStore.set(...);
  eventBus.emit(...);
  localStorage.setItem(...);
};
```

Why bad:

- mixes business logic, truth mutation, event emission, and I/O

---

## 14. Presentation patterns

## 14.1 Hooks connect UI to the architecture

Hooks may:

- subscribe to stores
- read projections
- call use cases
- manage refs/effects for view behavior

Hooks must not become:

- the module’s real business layer
- the persistence layer
- the engine control layer

## 14.2 Renderers are presentation-layer I/O

Renderers should:

- draw
- hit-test
- translate prepared data into pixels

Renderers should not:

- own business rules
- mutate truth directly
- call unrelated use cases during draw

## 14.3 Views are composition entry points

Views compose:

- hooks
- components
- contexts
- renderers

They are the public UI surface for the module.

---

## 15. Anti-patterns

| Anti-pattern                                                | Why it is bad                             | Preferred fix                                   |
| ----------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| class-based domain models owning logic and runtime concerns | mixes truth and behavior awkwardly        | use plain types + functions                     |
| repository emits domain events or multi-step orchestration  | I/O layer becomes business layer          | move orchestration to use case; thin store get/set for owned state may stay in-repo |
| use case directly calls browser/desktop APIs everywhere     | write boundary leaks I/O details          | isolate I/O in repositories                     |
| presentation hook owns validation + persistence + runtime   | UI becomes business layer                 | thin hook, explicit use case                    |
| presentation store imported cross-module                    | private UI state becomes contract surface | move to business `stores/` only if truly shared |
| renderer mutates truth during draw                          | hot path becomes hidden write layer       | route writes through useCases                   |
| giant `trackActions.ts` file                                | hidden coupling, hard review              | one function per file                           |
| `src/helpers` absorbs module-specific logic                 | shadow architecture                       | keep module-owned logic in module               |
| event used for every field change                           | event noise                               | emit only meaningful events                     |
| module exports everything “just in case”                    | weak encapsulation                        | minimal public surface                          |

---

## 16. Naming guidance

You do not need perfect naming uniformity across the whole repo during migration, but inside a module prefer consistent intent:

### Good

- `addTrack.ts`
- `moveClip.ts`
- `validateClipPlacement.ts`
- `transformTrackToEngineConfig.ts`
- `setTrackGainInEngine.ts`
- `useArrangement.ts`
- `ArrangementView.tsx`

### Avoid

- `utils.ts`
- `helpers.ts`
- `misc.ts`
- `trackActions.ts`
- `trackService.ts` when it is actually a repository
- `manager.ts` unless it truly manages lifecycle/runtime ownership

Names should reveal responsibility, not hide it.

---

## 17. How to decide whether something should be a new module

Create or split a module when:

- a distinct slice of truth has a clear owner
- invariants cluster together
- the write boundary becomes clearer if separated
- runtime/infrastructure complexity justifies isolation
- cross-boundary mutation would otherwise become messy

Do **not** create a new module just because:

- a folder got big
- a UI screen exists
- a product capability sounds important
- you want prettier diagrams

Module boundaries exist for ownership and invariants, not for cosmetics.

---

## 18. Review checklist

Before accepting TypeScript module architecture work, verify:

1. Is the module boundary an ownership boundary, not just a UI slice?
2. Are the contract-folder barrels (`useCases/`, `events/`, `stores/`, `presentations/views/` `index.ts`) narrow, intentional surfaces for **other** modules only (not a full re-export, each scoped to its own folder), and do in-module files avoid importing their own barrels (`#/modules/<ThisModule>/useCases`, etc.) in favor of relative paths?
3. Are models plain and framework-free?
4. Are use cases the real write boundary?
5. Are use-case **types** kept private (no `export type` from `useCases/` on its `useCases/index.ts` barrel for other modules)?
6. Are repositories truly I/O-only?
7. Are validators/services/transformers private and well-scoped?
8. Are business stores separated from presentation stores?
9. Are promoted views re-exported from the `presentations/views/index.ts` barrel while hooks/components/context/renderers stay private by default?
10. Is cross-module interaction happening only via each module’s contract-folder barrels (`useCases`/`stores`/`events`/`presentations/views`) and approved patterns?
11. Did the refactor reduce or increase hidden coupling?

---

## 19. Summary

A TypeScript module in this DAW is:

- a bounded context
- an ownership boundary
- a place where one slice of truth is governed
- a narrow public contract plus private internals
- a presentation layer over an explicit write boundary
- a unit that should remain understandable without leaking its guts across the codebase

The essential idea is simple:

```text
Plain models
+ explicit use cases
+ thin repositories
+ narrow public contracts
+ private presentation internals
= healthy module architecture
```
