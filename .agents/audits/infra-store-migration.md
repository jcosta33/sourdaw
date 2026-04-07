# Audit: Store Infrastructure Migration

## Goal

Migrate all shared state within `src/modules` from the legacy `#/helpers/Store` OOP class implementation to the new functional client-only primitive at `src/infra/store`. The new primitive mandates a strict read-only public contract (`get()`, `subscribe()`), encapsulates writes via a hidden `getController(store)` side-table, and simplifies React usage via a unified `useStore(store)` hook.

## Current State

The legacy store infrastructure is deeply integrated across the codebase:

- **Core Primitive:** `Store<T>` from `#/helpers/Store/Store.ts` is an OOP class exposing public mutation methods (`set`, `update`) and state access (`value`, `hydrate`).
- **Widespread Usage:** There are approximately 46 instances of the old `Store` class instantiated across various modules (e.g., `modules/Transport/stores/transportStore.ts`, `modules/Arrangement/stores/trackStore.ts`).
- **Persistence Coupling:** The old store accepts `Storage` engine injections. Currently, there are:
    - ~34 usages of `AutomergeStorage` coupling store state directly to CRDT document synchronization.
    - ~10 production usages of `LocalStorageStorage` (e.g., `modules/Workspace/stores/preferencesStore.ts`).
- **React Presentation:** Modules are currently importing React's `useSyncExternalStore` directly (over 100 usages) and manually binding `store.subscribe` and custom snapshot getters (often `() => store.value`).

## Findings

- **Persistence Gap:** The new `src/infra/store` is explicitly a _client-only_ state primitive. Replacing legacy stores that use `AutomergeStorage` or `LocalStorageStorage` directly with the new `createStore` will completely break CRDT sync and local persistence.
- **Leaky Mutations:** Because the legacy `Store` object exposes `.set()` and `.update()` natively, cross-module writes might currently be bypassing `useCases/` boundaries. The new infrastructure structurally prevents this.
- **Presentation Boilerplate:** The sheer volume of `useSyncExternalStore` imports in `presentations/views/` and `presentations/hooks/` represents significant boilerplate that the new `useStore()` hook is designed to eliminate.

## Open Issues

1. **Missing Persistence Strategy for New Stores**
    - **Description:** The new store primitive cannot replace `AutomergeStorage` or `LocalStorageStorage` backed stores without a new synchronization pattern.
    - **Needed:** A spec/design defining how the new client-only store will sync with Automerge (e.g., a synchronization layer in `useCases/` or a specialized persistence wrapper) before migrating persistent stores.

2. **Cross-Module Write Violations**
    - **Description:** Some modules may currently be calling `store.set()` or `store.update()` directly from outside the owning module's boundary.
    - **Needed:** An analysis of all `.set()` and `.update()` calls on legacy stores. Any cross-module mutations must be refactored into public `useCases/` of the owning module.

3. **Presentation Layer Boilerplate**
    - **Description:** React components are cluttered with manual `useSyncExternalStore` bindings to legacy stores.
    - **Needed:** Replace manual `useSyncExternalStore` calls with the new `useStore(store)` hook during the migration of each store.

4. **API Surface Mismatch**
    - **Description:** Legacy stores are read via `.value` property. The new store uses a `.get()` method.
    - **Needed:** Mechanical refactoring of all `store.value` reads to `store.get()` within non-React consumer logic.

## Priorities

1. **Blocker:** Define the persistence strategy (Automerge / LocalStorage) compatible with the new functional store infrastructure.
2. **Pilot:** Identify strictly transient, in-memory legacy stores (e.g., `timelineViewStore`, `controlSurface`) and migrate them to `createStore()` as a proof-of-concept.
3. **Execution:** Refactor legacy `.set()` / `.update()` calls to strictly use `getController(store)` within the module's internal use cases.
4. **Cleanup:** Migrate React components consuming the pilot stores to use `useStore()`.

## Risks

- **Data Loss/Desync:** Blindly migrating stores that currently use `AutomergeStorage` will result in local-only state changes not propagating to the CRDT document, breaking real-time collaboration.
- **Silent Failures:** If a cross-module write is missed during refactoring, the TypeScript compiler will catch the missing `.update()` method, but resolving it will require creating new use cases on the fly, potentially slowing down the migration effort.

## Suggested Approaches

- **Phased Migration:** Do not attempt a "big bang" replacement. Migrate purely transient stores first (e.g., `AiRuntime`, `UI` state).
- **Persistence Adapters:** Instead of building persistence into `createStore`, consider writing synchronization services in the `repositories/` or `services/` layers that listen to the new store via `.subscribe()` and flush changes to Automerge/LocalStorage (or vice versa).
- **Mechanical Refactoring:** For in-memory stores, the migration is mostly mechanical:
    1. Change `new Store(...)` to `createStore(...)`.
    2. Search and replace `store.value` with `store.get()`.
    3. Inside the owning module, replace `store.set(x)` with `getController(store).set(x)`.
    4. In React views, replace `useSyncExternalStore(store.subscribe, () => store.value)` with `useStore(store)`.

## Resolved

- None yet.
