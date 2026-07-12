# Dependency Injection

Business-layer code wires collaborators through **`inject()`** from `#/infra/di/inject`. Use cases and repositories that perform I/O or call other application services declare dependencies in the dependency map; they are resolved at **call time**, not by ad hoc static imports of repos and use cases.

**Canonical reference:** `docs/architecture/03-typescript-module.md` §4.10 — _Dependency injection with `inject()`_.

**Testing:** `docs/06-testing.md` §5 — use **`injectDependencies()`** for injectables; do not rely on module-level `vi.mock()` for collaborators that belong in the `inject()` map.

---

## `inject()` (required for use cases and service repositories)

```typescript
import { inject } from '#/infra/di/inject';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { eventBus } from '#/app/registerDependencies';

export const addTrack = inject({ eventBus, getTrackState, setTrackState })(
    ({ eventBus, getTrackState, setTrackState }) =>
        function addTrack(input: AddTrackInput): Track | null {
            // … orchestration using injected deps only
        }
);
```

Rules, dependency map shapes (classes, nested injectables, plain functions), and exceptions (pure helpers, models, React, audio hot paths) live in §4.10 — do not duplicate them here.

---

## `Container` (bootstrap / class tokens)

`src/infra/di/Container.ts` is a sync registry for **singleton** values keyed by **class** or other `DependencyKey`s. Call **`Container.register(token, value)`** once at app startup — never inside a use case, store, or component. There is no `getInstance()`; import `Container` and use `register`, `get`, `set`, `clear` as defined in that module.

App wiring starts from **`src/app/registerDependencies.ts`** (imported first from **`src/app/bootstrap.ts`**). `inject()` resolves class tokens from the container when they appear in a dependency map; plain functions and module exports (repos, `eventBus`, nested injectables) are wired per §4.10.

### Tokens

Class constructors and symbols can be used as keys; see `Container.ts` and §4.10.

### Lazy proxy

If resolution runs before bootstrap finishes, the container may return a lazy proxy and log a warning. Fix bootstrap order — do not work around this with module-top-level `Container.get()` in use case files.

---

## Presentation layer (React)

Hooks and **views** **do not** use `inject()`. They subscribe to stores via contract barrels, call **public** use cases from contract paths, or receive `eventBus` / similar from app wiring. Leaf **components** should not subscribe to business stores or call use cases — keep that in views/hooks and pass props. If a hook must read the container, resolve **inside** `useEffect`, not at module scope (avoids ordering issues after minification). Prefer passing dependencies in from parents or using existing app singletons documented in §4.10.

---

## What is still open

> [!NOTE]
> **Error handling** — no single documented pattern for surfacing errors from use cases to callers; `Result`-style alignment with Tauri is a future direction.

> [!NOTE]
> **Internationalisation (i18n)** — not yet documented end-to-end.
