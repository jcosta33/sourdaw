# Infrastructure Migration Audit (v2)

## Goal

The goal of this migration is to completely replace all usages of the legacy `src/helpers` utilities (specifically `DependencyInjector`, `Store`, `Event`, and `Errors`) with the newly implemented, functional primitives located in `src/infra`. Once the migration is complete, the old `src/helpers` infrastructure code should be deleted. This aligns the codebase with the updated V2 architecture specs, promoting safer write boundaries, explicit functional DI, plain-object errors, and async-safe events.

## Current State

The legacy infrastructure is still heavily integrated across the application modules.

- **Dependency Injection (`#/helpers/DependencyInjector`)**: Found ~94 usages across the `src/modules` directory. The majority of these are module-scope resolutions utilizing `Container.getInstance().get(...)`, which can cause strict-mode crashes and bootstrap race conditions.
- **Stores (`#/helpers/Store`)**: Found ~82 usages. Modules are instantiating class-based `Store` instances and importing persistence helpers like `AutomergeStorage` and `LocalStorageStorage` from `src/helpers`.
- **Events (`#/helpers/Event`)**: Found 12 usages. These include inheriting from the legacy `DomainEvent` class, utilizing `APP_EVENTS` constants for DOM-based UI event triggers, and older `EventBus` usages.
- **Errors (`#/helpers/Errors`)**: Found 1 usage (`Transport/errors/InvalidTempoError.ts`). It currently extends the legacy `AppError` class instead of utilizing the new functional shape.
- **UI Framework Hooks**: The legacy `useStore` hooks and older React adapter hooks are still likely coupled with the old class-based Stores.

## Findings

- The scale of the `DependencyInjector` migration is the largest, touching almost every module's stores, use cases, and repositories.
- The `Store` migration involves uncoupling persistence (like `AutomergeStorage`) from the core store primitive. The new `src/infra/store` is entirely client-state only and has no built-in persistence layers, meaning `AutomergeStorage` and `LocalStorageStorage` will either need to be rewritten to wrap the new functional stores or migrated into their respective domain module boundaries (e.g., `CrdtDocument`).
- The legacy `AppError` is class-based. The new `src/infra/errors/AppError` is a flattened, plain object. This requires refactoring `InvalidTempoError` (and potentially other undiscovered module-local custom errors) to use `createAppError`.
- The new `EventBus` has dropped the `createDomainEvent` wrapper and relies purely on TypeScript types. Legacy `DomainEvent` class inheritances (`AudioDeviceLoadedEvent.ts`, `TrackRemovedEvent.ts`, `TrackAddedEvent.ts`) need to be converted to plain types in their respective module `EventMap`.

## Priorities & Issues

1. **Migrate Errors**
   - **Needed:** Refactor `src/modules/Transport/errors/InvalidTempoError.ts` to use `createAppError` from `src/infra/errors/createAppError` instead of extending the `AppError` class. Update any throw/catch sites.

2. **Migrate Events**
   - **Needed:** Convert `AudioDeviceLoadedEvent`, `TrackRemovedEvent`, and `TrackAddedEvent` from classes to plain TypeScript types.
   - **Needed:** Refactor usages of `APP_EVENTS` (currently used in UI tabs and shortcuts) to either use the new typed `EventBus` from `src/infra/events` or migrate that logic into proper `useCases` (as identified in the `di-events-errors-audit.md`).
   - **Needed:** Update `AudioEngine` and `Toaster` usages of `EventBus` to the new `src/infra/events` API.

3. **Migrate Stores**
   - **Needed:** Convert all ~82 module stores from the legacy `new Store(...)` instances to `createStore(...)` from `src/infra/store`.
   - **Needed:** Replace `useStore` imports in React components to point to `src/infra/store/useStore`.
   - **Needed:** Address persistence logic. `AutomergeStorage` and `LocalStorageStorage` must be migrated or adapted to sync with the new functional stores via `getController(store).set()`.

4. **Migrate Dependency Injection**
   - **Needed:** Replace all `Container.getInstance().get(...)` calls at the module level with the new `inject(deps, (deps) => (args) => { ... })` wrapper from `src/infra/di/inject`.
   - **Needed:** Update the bootstrap file to use `Container.register` / `Container.set` from `src/infra/di/Container`.
   - **Needed:** Refactor test files to use `injectDependencies(useCase, mocks)` instead of `vi.mock` on the old container.

5. **Delete Legacy Helpers**
   - **Needed:** Once all modules have been migrated, delete `src/helpers/DependencyInjector`, `src/helpers/Store`, `src/helpers/Event`, and `src/helpers/Errors`.

## Risks

- **Race Conditions:** Delaying the DI migration leaves the app susceptible to bootstrap evaluation order crashes if strict mode is ever fully enabled.
- **Architectural Drift:** Keeping both the old `src/helpers` and the new `src/infra` creates confusion and mixed patterns. Developers/Agents may unknowingly continue using the old infrastructure, exacerbating technical debt.
- **Persistence Regression:** Moving away from the legacy `Store` could break existing project persistence if `AutomergeStorage` logic is not carefully adapted to interact with the new `getController()` write mechanism.

## Suggested Approaches

1. **Incremental Module-by-Module Migration:** Start with leaf modules (like `Errors` or `Events`) before tackling the large `DI` and `Store` usages.
2. **Persistence Adapter:** Before migrating all stores, establish a pattern for how the new `Store` integrates with CRDTs/Local Storage. You may need to create an adapter function (e.g., `syncWithAutomerge(store, crdtDoc)`) that listens to the store and writes to Automerge, and vice-versa.
3. **Automated Replacements:** For the `DependencyInjector`, use automated search-and-replace scripts or generalist agents to batch-convert the boilerplate `Container.getInstance().get` calls into the `inject` wrapper pattern.

## Resolved
- None yet.
