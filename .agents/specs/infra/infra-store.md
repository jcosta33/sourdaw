# Store Infrastructure

> **Changelog (review revision):**
>
> - Renamed `getSnapshot()` → `get()` (React jargon doesn't belong in module code)
> - Renamed `getStoreController()` → `getController()` (redundant prefix — already in Store module)
> - Renamed `setSnapshot()` → `set()` on controller (clean `set`/`update` pair)
> - Removed boilerplate controller file pattern — use cases call `getController()` directly
> - Dropped `recordStore()` testing helper from v1 (synchronous `get()` + spy on subscribe is sufficient)
> - Clarified that Store does NOT share internal subscription code with EventBus — each owns its own listener management

## Context

The DAW architecture treats `stores/` as a public contract surface for shared business/read state, while `useCases/` remain the write boundary and `presentations/hooks/` remain private by default.

The existing infra research already establishes the desired implementation style for shared helpers:

- factory functions returning plain objects
- closure-based privacy
- explicit named exports
- internal-only utilities not re-exported publicly

This feature exists to replace the old company store helper with a minimal store primitive that is trivial to consume from modules and React presentations, while structurally preventing cross-module writes.

---

## Goal

Implement a client-only store primitive that supports:

- clean module usage:
  `export const transportStore = createStore(initialState);`
- safe cross-module reads
- hidden local write access for module-owned use cases
- a tiny shared React adapter that hides `useSyncExternalStore` verbosity

---

## User-visible behavior

From the caller's point of view:

- a module exports a store with one line
- consumers can call `useStore(transportStore)` in React
- consumers can call `transportStore.get()` outside React
- the exported store object has no write methods
- the owning module can still mutate the store through `getController()` used only by its own `useCases/`

---

## Scope

## **In scope:**

- `Store<TSnapshot>` public contract
- `createStore()`
- hidden internal write controller via `getController()`
- `useStore()` React hook
- docs/examples that standardize the store shape

## **Non-goals (explicitly out of scope):**

- `recordStore()` testing helper (synchronous `get()` makes this unnecessary in v1)
- shared internal subscription code with EventBus (each module owns its own listener management)
- `asReadonly()` wrapper (the controller pattern makes this unnecessary — the public surface is already read-only)
- SSR / hydration
- derived stores
- selector APIs
- batching
- persistence
- devtools
- undo/redo
- async resource stores
- replacing every existing store call site in this spec

---

## Requirements

1. **Public store contract is runtime read-only** — exported stores must physically expose only:
    - `subscribe(listener): () => void`
    - `get(): TSnapshot`

2. **No fake privacy** — do not rely only on TypeScript narrowing to "hide" write methods. The exported object must not physically contain `set`, `update`, or equivalent write APIs.

3. **Hidden controller** — every store must have internal write access available through `getController(store)`, backed by closure state plus a `WeakMap` side table.

4. **Clean module export** — the intended module usage must be:
   `export const transportStore = createStore<TransportState>(initialState);`

5. **React adapter** — implement:
   `useStore<TSnapshot>(store: Store<TSnapshot>): TSnapshot`
   using `useSyncExternalStore`.

6. **Client-only** — do not implement `getServerSnapshot`, SSR branches, or hydration logic.

7. **Snapshot stability** — `get()` must return the exact same reference while state has not changed.

8. **No-op writes do not notify** — writes must skip notification when `Object.is(previousSnapshot, nextSnapshot)` is true.

9. **No eager subscribe emission** — `subscribe()` should register/unregister listeners only. It must not immediately invoke listeners with the current snapshot.

10. **Cross-module reads only** — other modules may read stores, but meaningful writes must still go through the owning module's public `useCases/`.

11. **No shared subscription internals** — the Store must NOT share internal subscription/listener management code with the EventBus. Each module owns its own listener implementation. The two have different semantics (Store listeners receive no arguments; EventBus handlers receive typed payloads) and coupling them creates a false DRY abstraction.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`)
- Must be implemented with plain objects and closures
- No public classes
- No decorators
- No default exports
- No React import in the store core
- React integration must live only in `useStore.ts`
- Use explicit control flow and named exports
- Keep module-specific behavior out of `#/helpers/Store/*`

---

## Design decisions

### Decision: Public store API shape

**Chosen:**

A public store is:

```ts
export type Store<TSnapshot> = {
    subscribe(listener: () => void): () => void;
    get(): TSnapshot;
};
```

**Considered and rejected:**

- `getSnapshot()` as the method name
    - rejected because it is React jargon from `useSyncExternalStore`; module code should not carry framework vocabulary; internally the implementation still passes `get` to `useSyncExternalStore`'s `getSnapshot` parameter
- `store.value`
    - rejected because it conflicts with the infra research direction and does not align as cleanly with `useSyncExternalStore`
- `get()/set()/update()` on the same public object
    - rejected because it leaks mutation across module boundaries
- Svelte-style immediate subscribe emission
    - rejected because React external-store usage already reads current state through `get()`
- `asReadonly()` wrapper from the research
    - rejected because the controller pattern already solves this more strongly — the public surface is structurally read-only at runtime, not just wrapped

### Decision: Hidden write access

**Chosen:**

Use a `WeakMap` side table keyed by the public store object, holding:

```ts
type StoreController<TSnapshot> = {
    set(next: TSnapshot): void;
    update(updater: (prev: TSnapshot) => TSnapshot): void;
};
```

**Considered and rejected:**

- `setSnapshot` / `update` naming pair
    - rejected because `set` / `update` is a cleaner pair — the `store` context is already established
- exporting separate `{ contract, controller }`
    - rejected because it makes module usage noisier than necessary
- public store object with type-hidden write methods
    - rejected because it is not a real boundary
- classes with `#private`
    - rejected because the repo direction is factory functions + plain objects
- per-module boilerplate controller file (`stores/internal/transportStoreController.ts`)
    - rejected because it is a one-liner file duplicated across every module; use cases should call `getController(store)` directly

### Decision: React adapter

**Chosen:**

A single shared helper:

```ts
export function useStore<TSnapshot>(store: Store<TSnapshot>): TSnapshot;
```

**Considered and rejected:**

- requiring every module hook to call `useSyncExternalStore` manually
    - rejected because it repeats noise everywhere
- exporting public React hooks from infra per store
    - rejected because hooks belong in module presentations, not helpers

### Decision: No shared subscription internals with EventBus

**Chosen:**

Store and EventBus each own their own listener management. No shared `SubscriptionManager` or `createSubscriptionRegistry`.

**Considered and rejected:**

- shared `SubscriptionManager<T>` from the research
    - rejected because the two have different semantics (Store listeners receive no arguments and are used with `useSyncExternalStore`; EventBus handlers receive typed payloads and return `Promise<void>`). Coupling them creates a false DRY abstraction that fights both use cases.

### Decision: No testing helper in v1

**Chosen:**

No `recordStore()` testing helper. Store reads are synchronous via `get()`, so tests just assert directly:

```ts
controller.set(nextState);
expect(store.get()).toEqual(nextState);
```

If notification count matters, a spy on `subscribe` is sufficient.

**Considered and rejected:**

- `recordStore()` helper
    - rejected because it adds ceremony for something already trivial with synchronous `get()`

---

## Acceptance criteria

- [ ] `createStore(initial)` returns an object with only `subscribe` and `get`
- [ ] Cross-module consumers cannot call `transportStore.set(...)` or `transportStore.update(...)`
- [ ] `getController(store)` recovers write access for the owning module
- [ ] `useStore(store)` returns the current snapshot and re-renders on change
- [ ] `get()` returns the same reference until a write replaces it
- [ ] No-op writes do not notify listeners
- [ ] `subscribe()` does not eagerly emit current state
- [ ] Public API uses named exports only
- [ ] Store does not import or share code with EventBus internals
- [ ] `pnpm deps:validate` passes with zero violations

---

## Implementation notes

Suggested helper layout:

```text
src/helpers/Store/
  createStore.ts
  types.ts
  useStore.ts
  internal/
    getController.ts
```

Suggested module usage:

```ts
// Transport/stores/transportStore.ts
import { createStore } from '#/helpers/Store/createStore';

export type TransportState = {
    isPlaying: boolean;
    tempo: number;
    positionBeats: number;
};

export const transportStore = createStore<TransportState>({
    isPlaying: false,
    tempo: 120,
    positionBeats: 0,
});
```

```ts
// Transport/useCases/startTransport.ts
import { getController } from '#/helpers/Store/internal/getController';
import { transportStore } from '../stores/transportStore';

export const startTransport = (): void => {
    getController(transportStore).update((prev) => ({
        ...prev,
        isPlaying: true,
    }));
};
```

```ts
// Transport/presentations/hooks/useTransport.ts
import { useStore } from '#/helpers/Store/useStore';
import { transportStore } from '../../stores/transportStore';

export const useTransport = () => {
    return useStore(transportStore);
};
```

Recommended implementation detail:

- keep snapshot and listener set in closure
- use a `WeakMap<Store<any>, StoreController<any>>` side table for hidden controllers
- do not require `Symbol.dispose`

---

## Test plan

- [ ] Unit: `createStore()` exposes only `subscribe` and `get` on the public object
- [ ] Unit: `get()` returns the initial snapshot
- [ ] Unit: listener is called on write and not called on no-op write
- [ ] Unit: `subscribe()` returns an unsubscribe function that stops notifications
- [ ] Unit: `subscribe()` does not immediately emit
- [ ] Unit: `getController(store)` can `set` and `update` the store
- [ ] React: `useStore()` re-renders when the snapshot changes
- [ ] React: `useStore()` does not re-render on no-op write
- [ ] Manual: create a small module store and consume it from another module's presentation

---

## Open questions

None. All previously open questions have been resolved as design decisions.

---

## Tradeoffs and risks

This design is intentionally narrow. It does not include selectors, derived stores, or persistence in v1.

The main risk is under-building if a large number of existing call sites depend on richer company-store behavior. That risk is acceptable because the goal here is replacement with a simpler, cleaner primitive, not a compatibility clone.
