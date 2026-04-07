# Infrastructure Module Quality Audit

## Scope

This audit covers the `src/infra/` module — the functional replacement for the legacy `src/helpers/` infrastructure. Four sub-modules are in scope: `di/`, `errors/`, `events/`, and `store/`. Tests, testing utilities, and internal modules are all included.

Excluded: consumption sites (no module has adopted `src/infra` yet), the legacy `src/helpers/` code, and the migration plan itself (covered by `infra-migration-v2.md`).

Related specs: `docs/01-dependency-injection.md`, `docs/03-state-management.md`, `docs/04-events.md`, `docs/06-testing.md`, `docs/07-conventions.md`.

## Goal

Evaluate the new `src/infra` module against three criteria:

1. **Internal quality** — Is the code correct, minimal, idiomatic, and consistent with the project's conventions (`docs/07-conventions.md`, `AGENTS.md`)?
2. **API design** — Does the public surface follow the project's philosophy (fully functional, hide complexity, leverage modern ECMAScript)?
3. **Adoption readiness** — Are there gaps that will block or complicate the migration from `src/helpers`?

---

## Relevant code paths

| Sub-module | Key files |
|---|---|
| `di` | `Container.ts`, `inject.ts`, `types.ts`, `internal/containerState.ts` |
| `di/testing` | `createTestContainer.ts`, `createMock.ts`, `spy.ts`, `injectDependencies.ts` |
| `errors` | `AppError.ts` (re-exports), `createAppError.ts`, `isAppError.ts`, `result.ts` |
| `errors/testing` | `assertOk.ts`, `assertErr.ts` |
| `events` | `createEventBus.ts`, `types.ts`, `internal/createSubscriptionRegistry.ts` |
| `events/testing` | `recordEvents.ts` |
| `store` | `createStore.ts`, `useStore.ts`, `types.ts` |
| `store/storage` | `types.ts`, `createMemoryStorage.ts`, `createLocalStorage.ts`, `createAutomergeStorage.ts` |
| `logger` | `createLogger.ts`, `createConsoleWriter.ts`, `types.ts` |

---

## Current behavior

### `errors/` — AppError and Result

- `AppError.ts` re-exports from `createAppError.ts` and `isAppError.ts`. The canonical definitions live in those two files.
- `createAppError` conditionally spreads `cause` — omitted errors do not have a `cause` property, so `'cause' in error` is only true when a cause was explicitly provided.
- `isAppError` validates both `_tag` (string) and `message` (string), preventing false positives from objects with only `_tag`.
- `result.ts` is a clean, minimal Result monad with descriptive generic names (`TValue`, `TError`, `TMapped`, `TMappedError`).

### `di/` — Container and inject

- `Container.ts` is a plain object (not a class). The API is `register`, `set`, `get`, `clear`. `register` throws on duplicate tokens; `set` overwrites silently.
- `inject()` uses a **curried API**: `inject(deps)(factory)`. The first call locks in the dependency map type; the second call receives the factory with fully resolved types. For class-constructor deps, the resolved type is the instance type (e.g., `inject({ logger: Logger })` → factory receives `{ logger: Logger }`). This is powered by the `ResolveDependency` / `ResolveDependencies` mapped types.
- `DependencyKey<TValue>` accepts constructors, symbols, and strings — `Function` was removed to tighten the type.
- Circular dependency detection, memoization, async rejection, and test overrides all work as before.

### `events/` — EventBus

- `createEventBus.ts` uses `Promise.withResolvers()` (ES2024). Note: `tsconfig.json` `lib` may need updating to `es2024` or later to avoid type errors during `tsc --noEmit` (vitest runs fine).
- Async tracking with `pendingCount` + `waitForIdle()` is well-designed. Handler errors are caught and logged without interrupting other handlers.
- All generic type parameters use descriptive names (`TEvents`, `TEventName`, `TPayload`).

### `store/` — Store, useStore, and Storage Adapters

- `createStore(options)` accepts optional `storage`, `initialData`, and `logger`. API matches the old `Store<T>` class: `.value`, `.set()`, `.update()`, `.clear()`, `.hydrate()`, `.subscribe()`. Also exposes `.subscribeReact()` and `.getSnapshot()` for `useSyncExternalStore` integration.
- If the provided storage adapter reports `isSupported() === false`, falls back to `createMemoryStorage()` automatically.
- `useStore.ts` wraps `useSyncExternalStore` via `subscribeReact` and `getSnapshot`.
- **Storage adapters** (`store/storage/`):
  - `createMemoryStorage()` — plain in-memory, always supported. Used as fallback.
  - `createLocalStorage(key)` — persists via `localStorage` + SuperJSON. Lazy-loaded cache distinguishes "never read" from "read as null".
  - `createAutomergeStorage(docId, key, options?)` — CRDT-backed with `requestAnimationFrame` write-batching, `toCrdt` ephemeral field stripping, JSON round-trip for Proxy/undefined safety, and `hydrate()` for loading from Automerge docs.

### `logger/` — Logger and Writers

- `createLogger(writers?)` — functional logger with `debug`, `info`, `warn`, `error`, and `setWriters`. 1-1 replacement for the old `Logger` class.
- `createConsoleWriter()` — formats output as `[DEV][SEVERITY]` prefix, matching the old `ConsoleWriter` class.

### Testing utilities

- `spy()` and `createMock()` both use `Proxy` for lazy `vi.fn()` creation. Both handle the `then` trap correctly.
- `injectDependencies()` resets the container and validates mock completeness before injection.
- `assertOk()` / `assertErr()` provide clean Result unwrapping for tests.
- `recordEvents()` returns defensive copies via a getter.

### Test suite

- 81 tests across 13 files. All passing.
- Test naming consistently follows the `should` convention from `docs/06-testing.md`.

---

## Findings

1. ~~**No persistence hook in `store/`.**~~ **RESOLVED** — `createStore` now accepts a `storage` option. Three adapters implemented: `createMemoryStorage`, `createLocalStorage`, `createAutomergeStorage`. API is a 1-1 match with the old `Store` class.

2. **`result.ts` functions take positional arguments.** The project convention (`docs/07-conventions.md`) says "Functions with more than one parameter take a single object param." Functions like `map(result, fn)` use two positional params. This is conventional for FP utilities and reads better than `map({ result, fn })`, but it's technically a convention deviation. Consider whether the convention needs a carve-out for small FP utilities.

3. **Duplicate `.test.ts` files still exist.** `createEventBus.test.ts` and `createStore.test.ts` still exist (not deleted per safety rules). The `.test.ts` files have been updated to use the new API but should still be manually deleted to avoid running duplicate tests.

4. **`tsconfig.json` lib target.** `Promise.withResolvers()` in `createEventBus.ts` causes a TS2550 error during `tsc --noEmit` because the lib target doesn't include `es2024`. This is pre-existing and affects typecheck but not runtime (vitest transpiles fine).

---

## Priorities

1. **Issue 3 — Delete duplicate `.test.ts` files** (cleanup: prevents test count inflation)
2. **Issue 4 — Update tsconfig lib to es2024** (correctness: fixes typecheck error)
3. **Issue 2 — FP utility convention carve-out** (documentation: minor)

---

## Open issues

### 1. Duplicate `.test.ts` files need manual deletion

**Problem:** `src/infra/events/createEventBus.test.ts` and `src/infra/store/createStore.test.ts` still exist with their old content. Test content has been merged into the corresponding `.spec.ts` files, but the `.test.ts` files were not deleted (safety rules prohibit file deletion).

**Representative files:** `src/infra/events/createEventBus.test.ts`, `src/infra/store/createStore.test.ts`

**Needed:** Manually delete both files.

### 2. tsconfig lib target does not include es2024

**Problem:** `Promise.withResolvers()` in `createEventBus.ts:13` causes `TS2550` during `tsc --noEmit`.

**Representative files:** `src/infra/events/createEventBus.ts:13`

**Needed:** Add `"es2024"` (or later) to the `lib` array in `tsconfig.json`.

---

## Open questions

- [x] ~~Should `createStore` support an optional persistence adapter?~~ Yes — implemented. `createStore({ storage, initialData, logger })`.
- [x] ~~Docs reference old `src/helpers/` paths?~~ Updated — `docs/01-dependency-injection.md`, `docs/04-events.md`, `docs/06-testing.md`, `docs/architecture/03-typescript-module.md` now reference `#/infra/`.
- [ ] Should the `docs/07-conventions.md` positional-parameter rule have a carve-out for small FP utility functions?

---

## Risks

- **Duplicate test files will run the same tests twice** until manually deleted, inflating pass counts and adding confusion.
- **Pre-existing typecheck failure** from `Promise.withResolvers` will cause CI failures if strict typecheck is enabled before the lib target is updated.

---

## Suggested approaches

### Persistence adapter pattern

Rather than building persistence into `createStore`, write synchronization services in `repositories/` or `services/` that listen to the new store via `.subscribe()` and flush changes to Automerge/LocalStorage (or vice versa). See `infra-store-migration.md` for the full strategy.

---

## Recommendation

Delete the duplicate `.test.ts` files immediately (2 files, no risk). Then update `tsconfig.json` lib target. Store migration can begin — storage adapters are implemented and the `createStore` API matches the old `Store` class.

---

## Resolved

### 1. Duplicate `AppError` definitions *(was Issue 1)*

`AppError.ts` and `createAppError.ts` both exported the same type and factory with subtly different `cause` handling. Consolidated: `AppError.ts` now re-exports from `createAppError.ts` and `isAppError.ts`. Single source of truth.

### 2. `cause: undefined` always written *(was Issue 2)*

`createAppError.ts` unconditionally spread `cause`, writing `cause: undefined` even when omitted. Fixed: uses conditional spread `...(cause !== undefined ? { cause } : {})`.

### 3. Incomplete `isAppError` guard *(was Issue 3)*

`isAppError.ts` only checked `_tag`. Fixed: now validates both `_tag` (string) and `message` (string).

### 4. `inject()` type erasure on resolved dependencies *(was Issue 4)*

Factory received `{ [K in keyof TDeps]: any }` — all types erased. Fixed: `inject()` now uses a curried API with `ResolveDependency<TDep>` / `ResolveDependencies<TDeps>` mapped types. Class-constructor deps resolve to their instance types. API: `inject(deps)(factory)`.

### 5. Duplicate test content *(was Issue 5)*

`createEventBus` and `createStore` each had both `.spec.ts` and `.test.ts` with overlapping coverage. Merged all unique test cases into `.spec.ts` files. `.test.ts` files still exist (need manual deletion — see Open Issue 1).

### 6. `DependencyKey<T>` included `Function` *(was Issue 6)*

Removed `Function` from the union. `DependencyKey<TValue>` now accepts only constructors, symbols, and strings.

### 7. Single-letter generic type parameters

All generics across the module renamed to descriptive names: `T` → `TValue`/`TSnapshot`/`TShape`, `E` → `TError`, `U` → `TMapped`, `F` → `TMappedError`, `K` → `TEventName`/`TKey`.

### 8. Pre-existing bug in `events/testing/testing.spec.ts`

Test destructured `entries` from the `recordEvents()` getter, capturing the empty array at destructure time. Fixed: uses `recorder.entries` to access the getter on each read.

### 9. No persistence hook in `store/` *(was Finding 1)*

`createStore` had no storage adapter support. Fixed: `createStore(options)` now accepts an optional `storage` adapter. Three adapters implemented matching the old `Store` class backends: `createMemoryStorage()`, `createLocalStorage(key)`, `createAutomergeStorage(docId, key, options)`. The `createStore` API exposes `.value`, `.set()`, `.update()`, `.clear()`, `.hydrate()`, `.subscribe()` — matching the old `Store<T>` class exactly. Store migration is now unblocked.

### 10. No Logger in `src/infra/`

Logger was only available via the old `src/helpers/Logger/Logger.ts` class. Added `src/infra/logger/` with functional equivalents: `createLogger(writers?)` and `createConsoleWriter()`. API matches the old `Logger` class.
