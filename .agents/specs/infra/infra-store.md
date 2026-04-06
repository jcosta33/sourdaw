# Store Infrastructure

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

From the caller’s point of view:

- a module exports a store with one line
- consumers can call `useStore(transportStore)` in React
- consumers can call `transportStore.getSnapshot()` outside React
- the exported store object has no write methods
- the owning module can still mutate the store through private infra used only by its own `useCases/`

---

## Scope

## **In scope:**

- `Store<TSnapshot>` public contract
- `createStore()`
- hidden internal write controller
- `useStore()` React hook
- minimal store test helper(s)
- docs/examples that standardize the store shape

## **Non-goals (explicitly out of scope):**

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
    - `getSnapshot(): TSnapshot`

2. **No fake privacy** — do not rely only on TypeScript narrowing to “hide” write methods. The exported object must not physically contain `set`, `update`, or equivalent write APIs.

3. **Hidden controller** — every store must have internal write access available through a private helper such as `getStoreController(store)`, backed by closure state plus a side table.

4. **Clean module export** — the intended module usage must be:
   `export const transportStore = createStore<TransportState>(initialState);`

5. **React adapter** — implement:
   `useStore<TSnapshot>(store: Store<TSnapshot>): TSnapshot`
   using `useSyncExternalStore`.

6. **Client-only** — do not implement `getServerSnapshot`, SSR branches, or hydration logic.

7. **Snapshot stability** — `getSnapshot()` must return the exact same reference while state has not changed.

8. **No-op writes do not notify** — writes must skip notification when `Object.is(previousSnapshot, nextSnapshot)` is true.

9. **No eager subscribe emission** — `subscribe()` should register/unregister listeners only. It must not immediately invoke listeners with the current snapshot.

10. **Cross-module reads only** — other modules may read stores, but meaningful writes must still go through the owning module’s public `useCases/`.

11. **Minimal test helper** — provide a tiny helper for tests, such as `recordStore(store)`, that subscribes and records emitted snapshots.

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
    getSnapshot(): TSnapshot;
};
```

**Considered and rejected:**

- `store.value`
    - rejected because it conflicts with the infra research direction and does not align as cleanly with `useSyncExternalStore`
- `get()/set()/update()` on the same public object
    - rejected because it leaks mutation across module boundaries
- Svelte-style immediate subscribe emission
    - rejected because React external-store usage already reads current state through `getSnapshot()`

### Decision: Hidden write access

**Chosen:**

Use a private side table keyed by the public store object, holding:

```ts
type StoreController<TSnapshot> = {
    setSnapshot(next: TSnapshot): void;
    update(updater: (prev: TSnapshot) => TSnapshot): void;
};
```

**Considered and rejected:**

- exporting separate `{ contract, controller }`
    - rejected because it makes module usage noisier than necessary
- public store object with type-hidden write methods
    - rejected because it is not a real boundary
- classes with `#private`
    - rejected because the repo direction is factory functions + plain objects

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

---

## Acceptance criteria

- [ ] `createStore(initial)` returns an object with only `subscribe` and `getSnapshot`
- [ ] Cross-module consumers cannot call `transportStore.update(...)`
- [ ] Internal module code can recover a controller for the store
- [ ] `useStore(store)` returns the current snapshot and re-renders on change
- [ ] `getSnapshot()` returns the same reference until a write replaces it
- [ ] No-op writes do not notify listeners
- [ ] `subscribe()` does not eagerly emit current state
- [ ] Public API uses named exports only
- [ ] `pnpm deps:validate` passes with zero violations

---

## Implementation notes

Suggested helper layout:

```text
src/helpers/Store/
  createStore.ts
  types.ts
  useStore.ts
  testing/
    recordStore.ts
  internal/
    storeRegistry.ts
    getStoreController.ts
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
// Transport/stores/internal/transportStoreController.ts
import { getStoreController } from '#/helpers/Store/internal/getStoreController';
import { transportStore } from '../transportStore';

export const transportStoreController = getStoreController(transportStore);
```

```ts
// Transport/useCases/startTransport.ts
import { transportStoreController } from '../stores/internal/transportStoreController';

export const startTransport = (): void => {
    transportStoreController.update((previousState) => ({
        ...previousState,
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
- use a `WeakMap` or equivalent side table for hidden controllers
- do not require `Symbol.dispose`

---

## Test plan

- [ ] Unit: `createStore()` exposes only read methods on the public object
- [ ] Unit: `getSnapshot()` returns the initial snapshot
- [ ] Unit: listener is called on write and not called on no-op write
- [ ] Unit: `subscribe()` returns an unsubscribe function that stops notifications
- [ ] Unit: `subscribe()` does not immediately emit
- [ ] Unit: hidden controller can update the store
- [ ] React: `useStore()` re-renders when the snapshot changes
- [ ] React: `useStore()` does not re-render on no-op write
- [ ] Manual: create a small module store and consume it from another module’s presentation

---

## Open questions

- [ ] **[MINOR]** Whether to expose a tiny `store.getSnapshot()` convenience alias for non-React code outside modules, or keep that as the only read API in v1
- [ ] **[MINOR]** Whether `recordStore()` should live in `testing/` or inline in tests if it stays tiny

---

## Tradeoffs and risks

This design is intentionally narrow. It does not include selectors, derived stores, or persistence in v1.

The main risk is under-building if a large number of existing call sites depend on richer company-store behavior. That risk is acceptable because the goal here is replacement with a simpler, cleaner primitive, not a compatibility clone.
