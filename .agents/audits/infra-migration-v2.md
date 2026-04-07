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
- The `Store` migration is now straightforward — `createStore(options)` accepts the same `storage`, `initialData`, and `logger` options as the old `Store` class. Three storage adapters have been implemented in `src/infra/store/storage/`: `createMemoryStorage()`, `createLocalStorage(key)`, `createAutomergeStorage(docId, key, options)`. The API surface (`.value`, `.set()`, `.update()`, `.clear()`, `.hydrate()`, `.subscribe()`) matches the old class exactly.
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
   - **Needed:** Convert all ~64 module stores from `new Store(logger, { storage, initialData })` to `createStore({ storage, initialData, logger })`.
   - **Needed:** Replace `new MemoryStorage()` → `createMemoryStorage()`, `new LocalStorageStorage(key)` → `createLocalStorage(key)`, `new AutomergeStorage(docId, key, opts)` → `createAutomergeStorage(docId, key, opts)`.
   - **Needed:** Replace `useStore` imports in React components to point to `src/infra/store/useStore`. Note: the new `useStore` returns `TData | null` (matching old behavior where `.value` could be null).
   - **Needed:** Replace `useSyncExternalStore(store.subscribe, getSnapshot)` manual calls with the new `useStore(store)` hook, or use `store.subscribeReact` and `store.getSnapshot` directly.

4. **Migrate Dependency Injection**
   - **Needed:** Replace all `Container.getInstance().get(...)` calls at the module level with the new curried `inject(deps)(factory)` wrapper from `src/infra/di/inject`.
   - **Needed:** Update the bootstrap file to use `Container.register` / `Container.set` from `src/infra/di/Container`.
   - **Needed:** Refactor test files to use `spy<T>()` + `injectDependencies(useCase, mocks)` instead of `vi.mock` on the old container.

5. **Delete Legacy Helpers**
   - **Needed:** Once all modules have been migrated, delete `src/helpers/DependencyInjector`, `src/helpers/Store`, `src/helpers/Event`, and `src/helpers/Errors`.

## Risks

- **Race Conditions:** Delaying the DI migration leaves the app susceptible to bootstrap evaluation order crashes if strict mode is ever fully enabled.
- **Architectural Drift:** Keeping both the old `src/helpers` and the new `src/infra` creates confusion and mixed patterns. Developers/Agents may unknowingly continue using the old infrastructure, exacerbating technical debt.
- **Persistence Regression:** The new storage adapters are 1-1 functional ports of the old class implementations. The risk is low, but each migrated store should be smoke-tested to confirm persistence still works (especially `AutomergeStorage` stores with `toCrdt` transforms).

## Suggested Approaches

1. **Incremental Module-by-Module Migration:** Start with leaf modules (like `Errors` or `Events`) before tackling the large `DI` and `Store` usages.
2. **Store Migration:** Storage adapters are implemented. Each store file is a mechanical replacement:
   ```
   // Before
   import { Store } from '#/helpers/Store/Store';
   import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
   const logger = Container.getInstance().get(Logger);
   export const myStore = new Store<T>(logger, { storage: new AutomergeStorage(docId, key, opts), initialData });

   // After
   import { createStore } from '#/infra/store/createStore';
   import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
   import { createLogger } from '#/infra/logger/createLogger';
   export const myStore = createStore<T>({ storage: createAutomergeStorage(docId, key, opts), initialData, logger });
   ```
3. **Manual File-by-File Migration:** For the `DependencyInjector`, migrate each file individually using the Edit tool. Do NOT use automated scripts or batch operations (per project rules in `AGENTS.md`).

## New `src/infra` API Reference (for migration agents)

> **Important:** The `inject()` API uses **currying** — `inject(deps)(factory)`, NOT `inject(deps, factory)`.

### Dependency Injection

```typescript
// Legacy (BEFORE):
import { Container } from '#/helpers/DependencyInjector/Container';
const logger = Container.getInstance().get(Logger);
const eventBus = Container.getInstance().get(EventBus);

export const myUseCase = (data: string) => {
    logger.info(data);
    eventBus.emit(new DataEvent(data));
};

// New (AFTER):
import { inject } from '#/infra/di/inject';
import { Logger } from '#/helpers/Logger/Logger';
import { EventBus } from '#/helpers/Event/EventBus';

export const myUseCase = inject({ logger: Logger, eventBus: EventBus })(({ logger, eventBus }) => {
    return (data: string) => {
        logger.info(data);
        eventBus.emit(new DataEvent(data));
    };
});
```

The factory receives fully typed dependencies — `logger` is typed as `Logger`, `eventBus` as `EventBus`.

### Testing migrated injectables

```typescript
import { describe, it, expect } from 'vitest';
import { spy } from '#/infra/di/testing/spy';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

describe('myUseCase', () => {
    it('should log and emit', () => {
        const logger = spy<Logger>();
        const eventBus = spy<EventBus>();

        injectDependencies(myUseCase, { logger, eventBus });

        myUseCase('hello');

        expect(logger.info).toHaveBeenCalledWith('hello');
    });
});
```

### Errors

```typescript
// Legacy: class-based
export class InvalidTempoError extends AppError { ... }
throw new InvalidTempoError('msg');

// New: plain object via factory
import { createAppError } from '#/infra/errors/createAppError';

const error = createAppError('InvalidTempo', 'BPM must be between 20 and 999', { bpm: 15 });
// error._tag === 'InvalidTempo', error.message === '...', error.bpm === 15

// Type guard:
import { isAppError } from '#/infra/errors/isAppError';
if (isAppError(caught)) { /* handle */ }
```

### Stores

```typescript
// Legacy:
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';

const logger = Container.getInstance().get(Logger);
export const myStore = new Store<MyState>(logger, {
    storage: new AutomergeStorage(docId, 'myKey', { toCrdt: (v) => ({ persistedField: v.persistedField }) }),
    initialData: defaultState,
});

myStore.set({ ...myStore.value!, count: 1 });
const val = myStore.value;

// New:
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

export const myStore = createStore<MyState>({
    storage: createAutomergeStorage(docId, 'myKey', { toCrdt: (v) => ({ persistedField: v.persistedField }) }),
    initialData: defaultState,
    logger, // optional — used for error logging in notify/hydrate
});

myStore.set({ ...myStore.value!, count: 1 });
const val = myStore.value; // same API — .value, .set(), .update(), .clear(), .hydrate(), .subscribe()

// Storage adapters:
import { createMemoryStorage } from '#/infra/store/storage/createMemoryStorage';     // in-memory only (default)
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';       // localStorage + SuperJSON
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage'; // Automerge CRDT

// React hook:
import { useStore } from '#/infra/store/useStore';
const state = useStore(myStore); // returns TData | null, replaces manual useSyncExternalStore
```

### Logger

```typescript
// Legacy:
import { Logger } from '#/helpers/Logger/Logger';
import { ConsoleWriter } from '#/helpers/Logger/Writer/ConsoleWriter';
const logger = new Logger([new ConsoleWriter()]);

// New:
import { createLogger } from '#/infra/logger/createLogger';
import { createConsoleWriter } from '#/infra/logger/createConsoleWriter';
const logger = createLogger([createConsoleWriter()]);
// Same API: logger.debug(), logger.info(), logger.warn(), logger.error(), logger.setWriters()
```

### Events

```typescript
// Legacy: class-based DomainEvent
export class TrackAddedEvent extends DomainEvent<{ trackId: string }> { ... }
eventBus.emit(new TrackAddedEvent({ trackId: '1' }));

// New: typed EventMap + functional EventBus
type ArrangementEvents = {
    'track.added': { trackId: string };
    'track.removed': { trackId: string };
};

import { createEventBus } from '#/infra/events/createEventBus';
const bus = createEventBus<ArrangementEvents>();
await bus.emit('track.added', { trackId: '1' });
bus.on('track.added', (payload) => { /* payload.trackId is typed */ });
```

## Resolved

- None yet.
