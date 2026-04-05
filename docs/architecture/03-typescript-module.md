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
- `Migration Architecture` — staged migration strategy

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
Plugin
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
- other modules may use public contract folders only
- private internals stay private
```

---

## 3. Module anatomy

A TypeScript module is composed of a **public contract surface** and **private internals**.

## 3.1 Public contract surface

These are the parts that other modules may depend on.

```text
errors/
events/
useCases/
stores/
presentations/views/
```

These folders expose the module’s public contract.

### Meaning of each public surface

| Folder                 | Role                             | Who uses it                      |
| ---------------------- | -------------------------------- | -------------------------------- |
| `errors/`              | stable domain/application errors | other modules, presentation      |
| `events/`              | meaningful domain events         | other modules, integration code  |
| `useCases/`            | public write boundary            | other modules, presentation      |
| `stores/`              | shared business/read state       | other modules, presentation      |
| `presentations/views/` | composable UI entry points       | other modules, route composition |

## 3.2 Private internals

These are implementation details and may change freely inside the module.

```text
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

These are private unless explicitly promoted to the contract surface.

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

- errors in `errors/` are part of the public contract
- internal helper errors should stay internal
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

  eventBus.emit(new ClipMovedEvent(...));
};
```

### Use cases must not

- call React hooks
- own rendering logic
- directly contain browser/Tauri I/O if that I/O belongs in a repository/adapter
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

### Use cases are a typed contract, not a re-export surface

A use case file must export its own typed function — never a pure re-export of a repository function. A file that only does `export { getX } from '../repositories/Y'` creates no real boundary; it launders private access through a fake public path. The **type signature** of the use case is the cross-module contract: the body may be thin (`return repo.method(input)`) but the signature uses the module's own types, or repo types only when the repository exposes pure models.

When a repository returns something that is not a pure model, the use case must define its own output type exposing only what consumers need.

See the `architecture-violations` skill (§6) for detailed rules and examples.

---

## 4.5 `stores/`

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

## 4.6 `validators/`

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

## 4.7 `services/`

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

## 4.8 `repositories/`

Repositories are the **I/O layer**.

They are thin adapters between business logic and the outside world.

A repository may access:

- Web Audio API
- localStorage / IndexedDB
- fetch / WebSocket
- Tauri `invoke` / `listen`
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

## 4.9 `transformers/`

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
- module-private unless explicitly exposed

Transformers are not mini-services with hidden behavior.

---

## 4.10 Dependency injection with `inject()`

Use cases and other injectable functions declare their dependencies explicitly using `inject()` from `#/helpers/DependencyInjector/inject`. This is the canonical DI mechanism for the business layer.

### Why `inject()`

Use cases need to call repositories, event buses, loggers, and other services. Three options exist for getting those references:

- **Direct imports** — the function imports its collaborators by name. Simple, but impossible to swap in tests without module-level mocking.
- **`Container.getInstance().get(Token)`** — call the container from inside the function. Works, but scatters resolution logic and makes dependencies implicit. Also: if called at module top-level, the read races with bootstrap order.
- **`inject()`** — declare dependencies as a map at the top of the file; the factory receives them as an argument. Dependencies are explicit, testable, and resolved from the container **at call time** (not import time).

`inject()` is the preferred pattern. It is what `injectDependencies()` (the test helper) expects, and it sidesteps the import-time-ordering trap.

### Shape

```typescript
import { inject } from '#/helpers/DependencyInjector/inject';
import { EventBus } from '#/helpers/Event/EventBus';
import { Logger } from '#/helpers/Logger/Logger';
import { TrackRepo } from '../repositories/TrackRepo';
import { TrackAddedEvent } from '../events/TrackAddedEvent';
import { createTrack } from '../models/Track';

type AddTrackInput = { name: string; kind: TrackKind };

export const addTrack = inject(
    { eventBus: EventBus, logger: Logger, trackRepo: TrackRepo },
    ({ eventBus, logger, trackRepo }) =>
        (input: AddTrackInput): Track | null => {
            const state = trackRepo.getState();
            if (state === null) {
                logger.log('addTrack called before store was ready');
                return null;
            }
            const track = createTrack(input);
            trackRepo.setState({
                ...state,
                tracks: [...state.tracks, track],
                selectedTrackId: track.id,
            });
            eventBus.emit(new TrackAddedEvent({ trackId: track.id, name: track.name, kind: track.kind }));
            return track;
        },
);
```

At call time, `addTrack(input)` resolves each dependency from the `Container` and invokes the factory with the resolved map. The caller writes `addTrack(input)` — they do not see or touch the dependency map.

**The factory must return a function** (the invoker). When you call the injectable, the wrapper calls the invoker with your args. Objects/services flow into the injectable via the dependency map, not as the factory's return.

### Dependency map values

The dependency map accepts three kinds of values:

| Value | Resolution |
|-------|------------|
| A class (e.g. `EventBus`) | Looked up via `Container.get(Class)` |
| Another injectable (from `inject(...)`) | Recursively resolved — the injectable's factory is invoked with its own deps, and the resulting function is passed to the outer factory |
| Anything else (plain function, object, constant) | Used as-is, no container lookup |

Classes resolve to their registered instance in the container. Injectables resolve to their invoker function. Plain values pass through.

### Resolution semantics

- **Memoized.** The first call to an injectable resolves its dependencies and calls the factory exactly once. The invoker is cached on the `Container` keyed by the injectable's token. Subsequent calls are a direct function invocation — no re-walk.
- **Cache reset on `Container.reset()`.** Test setup (`injectDependencies`) relies on this: it calls `reset()` before registering mocks, so the next invocation re-resolves against the fresh mocks.
- **Circular dependencies throw with a chain.** `A → B → A` fails at first invocation with the full chain in the message. Break the cycle by introducing an event or restructuring.
- **Async dependencies are forbidden.** If any value in the dependency map is a Promise, `inject()` throws at construction time. Resolve async modules before passing them in (typically in bootstrap). This is a deliberate constraint — keeps resolution sync and fast.

### What to wrap with `inject()`

| Layer | Wrap? | Why |
|-------|-------|-----|
| Use cases | **Yes** | Orchestrate repos/services, need to be mockable |
| Event subscribers | **Yes** | Need the EventBus + a service chain |
| Repositories with service dependencies | **Yes** | Logger, EventBus, Tauri shims |
| Pure transformers | No | Pure functions need nothing from the container |
| Validators / services (no I/O) | No | Pure functions |
| Models | No | Data |
| React hooks / components | No | Stay in the presentation layer; read stores directly |
| Engine classes (`TrackNode`, etc.) | No | Constructor-injected (pass `AudioContext` as an arg) |
| Audio-thread / hot-path code | **No** | The resolution + cached invocation has a cost; hot paths must not pay it |

If a function has no outbound side-effect dependencies, it does not need `inject()`. Wrapping pure code adds ceremony without benefit.

### Bootstrap discipline

Container registrations live in `src/app/bootstrap.ts`. The rules:

- **All class-token registrations happen in `bootstrap.ts` before any use case runs.** Use `registerOnce(Token, instance)` for this — it throws on duplicate registration, catching accidental double-wires.
- **Injectables self-register.** Don't hand-register an injectable's token in bootstrap; the resolver does it lazily on first call.
- **Never call `Container.get()` at module top-level.** If you need a value from the container outside a function body, wrap the surrounding function with `inject()` instead. Module-top-level `get()` calls race with bootstrap and trip the strict-mode guard in dev/test.

### Strict mode

In dev and test, `Container.get()` throws if the token is not registered. In production it currently falls back to a lazy Proxy with a `console.warn` (legacy behaviour for code-split chunks that evaluate before bootstrap). As the codebase migrates to `inject()`, the production fallback will be retired.

### Testing injectables

In tests, call `injectDependencies(injectable, mocks)` from `#/helpers/Testing/injectDependencies` to register a complete mock for every dependency. Use `spy<T>()` from `#/helpers/Testing/spy` to build typed method-level spies. See `docs/06-testing.md §5` for the canonical test shape.

---

## 4.11 `presentations/`

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

Other modules may import from `presentations/views/`.

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

## 5.1 Public contract folders

These may be imported by other modules:

```text
errors/
events/
useCases/
stores/
presentations/views/
```

## 5.2 Private folders

These are module-private unless explicitly promoted later:

```text
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
runtime/
worklets/
```

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
  -> external APIs only
  -> shared helpers/types if truly generic

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

Modules should communicate through a narrow set of approved patterns.

## 7.1 Pattern A: direct use-case call

Use when:

- another module needs a synchronous business operation
- a return value matters
- the dependency is intentional and acceptable

Example:

```typescript
import { getRoutingForTrack } from '#/modules/Routing/useCases/getRoutingForTrack';
```

## 7.2 Pattern B: event-driven interaction

Use when:

- another concern should react independently
- the emitter should not care who reacts
- the occurrence has business meaning

Example:

```typescript
eventBus.emit(new TrackAddedEvent(...));
```

## 7.3 Pattern C: shared store / selector read

Use when:

- presentation or read-side logic needs another module’s state
- no write is required
- the read is stable and intentional

Example:

```typescript
const transport = transportStore.value;
```

## 7.4 Pattern D: view composition via `presentations/views/`

Use when:

- one module includes another module’s UI entry point
- the dependency is presentational, not business-layer

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

Example: `Mixer` is often presentation-only if it reads from Arrangement + Routing + Telemetry rather than owning its own truth.

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
├── _tests/
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
│   └── createTauriEngineAdapter.ts
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
  eventBus.emit(new ProjectSavedEvent(...));
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
| repository emits business events and mutates stores         | I/O layer becomes business layer          | move orchestration to use case                  |
| use case directly calls browser/Tauri APIs everywhere       | write boundary leaks I/O details          | isolate I/O in repositories                     |
| presentation hook owns validation + persistence + runtime   | UI becomes business layer                 | thin hook, explicit use case                    |
| presentation store imported cross-module                    | private UI state becomes contract surface | move to business `stores/` only if truly shared |
| renderer mutates truth during draw                          | hot path becomes hidden write layer       | route writes through useCases                    |
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
2. Are public contract folders narrow and intentional?
3. Are models plain and framework-free?
4. Are use cases the real write boundary?
5. Are repositories truly I/O-only?
6. Are validators/services/transformers private and well-scoped?
7. Are business stores separated from presentation stores?
8. Are views public while hooks/components/context/renderers stay private by default?
9. Is cross-module interaction happening through approved patterns?
10. Did the refactor reduce or increase hidden coupling?

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
