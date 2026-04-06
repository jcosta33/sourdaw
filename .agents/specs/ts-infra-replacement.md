# Functional TS Infrastructure Spec

## Context
The project currently relies on infrastructure code (Dependency Injection, Event Bus, Store, Errors, Testing utils, etc.) located in `src/helpers/` that was copied from company code. We need to replace this with our own home-cooked, purely functional TS infrastructure based on the findings in `.agents/research/ts-infra.md`.

To ensure stability, the new infrastructure will be added seamlessly alongside the existing `src/helpers/` codebase. The existing code will remain untouched, allowing both systems to coexist until a future task systematically migrates usages.

## Scope
### In Scope
- Implementation of a functional Dependency Injection container.
- Implementation of a reactive Store and ReadonlyStore (Svelte store contract).
- Implementation of Storage backends (Memory, Web).
- Implementation of an async-first EventBus, DomainEvent types, and EventLog.
- Implementation of a discriminated union AppError and Result type.
- Implementation of testing utilities (`createSpy`, `createMock`, `createTestContainer`).
- Implementation of internal shared utilities (`SubscriptionManager`, `DisposableTracker`, branded ID factories).
- Writing comprehensive unit tests for the new infrastructure.
- Placing the new infrastructure in a new dedicated directory (e.g., `src/infra/`) to avoid conflicts with `src/helpers/`.

### Out of Scope
- Migrating existing code that imports from `src/helpers/` to the new `src/infra/`.
- Deleting or modifying any existing files in `src/helpers/`.
- Implementation of the CRDT/Automerge storage backend (only Memory and Web storage are in scope).

## Requirements & Design Decisions

### 1. Functional & Dependency-Free Core
- **No classes for public API:** Every public-facing construct must be a factory function (`createX`) returning a plain object with closure-based privacy.
- **Structural typing:** Interfaces should rely on structural typing, except for `Token<T>` and branded IDs (`EventId`, `CorrelationId`, `CausationId`) which must use phantom brands.
- **Zero external dependencies:** The library must use only TypeScript built-ins (`Map`, `Set`, `Proxy`, `Promise`, `Symbol`, `crypto.randomUUID()`). Testing utilities depend on `vitest` as a peer dependency.
- **Resource cleanup:** Every infrastructure object must implement `Disposable` using `Symbol.dispose`. A polyfill shim (`Symbol.dispose ??= Symbol('Symbol.dispose')`) must be included at the entry point.
- **Immutable public surfaces:** All returned types should use `Readonly<>`, `ReadonlyArray<>`, and `as const` where applicable. Store state is only mutable through `set`/`update`. EventLog entries are deeply readonly. DomainEvents are deeply frozen.
- **Error-first, throw-last:** Business logic should use `Result<T, AppError>` for expected failures. `throw` is reserved for programming errors (missing registrations, circular dependencies).

### 2. Module Structure
The new infrastructure must reside in `src/infra/` with a flat structure and a strict public barrel file:
```
src/infra/
├── index.ts                    # Public barrel — explicit named exports only
├── types.ts                    # All public type definitions
├── container/
├── store/
├── event-bus/
├── storage/
├── errors/
├── testing/
└── internal/
```
Internal utilities (`internal/`) must never be exported from `index.ts`.

### 3. DI Container (`src/infra/container/`)
- Must use branded symbol tokens (`Token<T>`) for type-safe registration/resolution.
- Must support lazy resolution (factories execute only on `resolve()`).
- Must support `singleton` and `transient` scopes.
- Must detect circular dependencies using a `Set<symbol>` and throw descriptive errors.
- Must support scoped child containers (`createChild()`) for testing overrides.
- Must provide an `inject()` helper function that creates a lazy resolver bound to a container.

### 4. Store & Projections (`src/infra/store/`)
- Must follow Svelte store contract (`get`, `set`, `update`, `subscribe`).
- `set()` must skip updates if `Object.is` equality is met.
- `subscribe()` must immediately invoke the listener with the current value.
- Must provide an `asReadonly()` wrapper that structurally removes mutation methods.
- Must provide a `createDerivedStore()` function with support for a custom `equals` comparison.
- Must support module-level batching (`batch()`) to defer notifications until mutations complete.

### 5. EventBus (`src/infra/event-bus/`)
- Must use EventMap generics for typed event names and payloads.
- Must support async-first emission, returning a Promise that resolves when all handlers complete.
- Must include idle detection (`waitForIdle()`, `pendingCount`, `isIdle`).
- Must support wildcard handlers (`onAny`) which receive both the event type string and the payload.
- `DomainEvent` must be a plain readonly object with a discriminated union `type` and explicit metadata (using branded IDs and `number` timestamps for serializability, not `Date` objects).
- Must include an `EventLog` append-only bounded buffer that tracks emissions via wildcard hooks and maintains a ring buffer behavior (`slice(-maxSize)`).

### 6. AppError & Result (`src/infra/errors/`)
- `AppError` must be a discriminated union using `_tag` string literals (e.g., `'NotFound'`, `'Validation'`, `'Unauthorized'`, `'Conflict'`, `'NetworkError'`, `'Unknown'`).
- Must provide factory functions for standard errors (`AppErrors.notFound`, etc.) and a type guard (`isAppError`).
- `Result<T, E>` must be a plain discriminated union (`ok: boolean`).
- Must provide standalone functional combinators (`map`, `flatMap`, `mapErr`, `tryCatch`, `unwrapOr`, `match`) to avoid prototype pollution.

### 7. Storage Backends (`src/infra/storage/`)
- Must define a synchronous `StorageBackend<T>` interface (`get`, `set`, `delete`).
- Must provide `createMemoryStorage()` and `createWebStorage(localStorage|sessionStorage)`.
- Must provide a higher-order factory `createPersistentStore()` to wrap a `Store` with a `StorageBackend` for hydration and persistence.

### 8. Testing Utilities (`src/infra/testing/`)
- `createSpy`: Typed spy factory wrapping `vi.fn()` with ergonomic assertions (`assertCalledWith`, `assertCalledTimes`, `assertNotCalled`) and properties (`calls`, `lastCall`).
- `createMock`: Proxy-based mock for interfaces that lazily creates `vi.fn()` stubs on property access, optionally taking `overrides`.
- `createTestContainer`: Creates a child container pre-populated with mock overrides, ensuring isolated DI contexts for tests.

## Acceptance Criteria
- [ ] A new `src/infra/` directory exists containing all specified modules.
- [ ] `src/infra/index.ts` exports only public factories and types; `internal/` is completely hidden.
- [ ] The public API contains absolutely no classes, decorators, or `reflect-metadata` usages.
- [ ] The DI container successfully detects and throws on circular dependencies.
- [ ] The EventBus `waitForIdle()` successfully blocks until all async handlers complete.
- [ ] The Store correctly skips notifications for identical values and processes batched updates atomically.
- [ ] Unit tests are provided for all modules in `src/infra/` and run successfully.
- [ ] No files within `src/helpers/` have been modified or deleted.
- [ ] Existing codebase compiles and tests pass without disruption.
- [ ] `pnpm deps:validate` passes with zero violations after the addition.

## Open Questions
- None. The specification relies on standard TS native primitives and functional closures as dictated by the research.
