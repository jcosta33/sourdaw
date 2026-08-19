# Dependency Injection

Business-layer code wires **mockable** collaborators through **`inject()`** from `#/infra/di/inject` (event buses, loggers, nested injectables). Thin same-module repository functions that only access the owned store may stay as static imports — see Arrangement `addTrack`.

**Canonical reference:** `docs/architecture/03-typescript-module.md` §4.11 — _Dependency injection with `inject()`_.

**Testing:** `docs/06-testing.md` §5 — use **`injectDependencies()`** for inject-map keys; `vi.mock` is OK for static repo imports that are not in the map.

---

## `inject()` (use cases — typical Arrangement shape)

```typescript
import { inject } from '#/infra/di/inject';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { ArrangementEventBus } from './arrangementEventBus';

export const addTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function addTrack(input: AddTrackInput): Track | null {
            const state = getTrackState(); // static thin repo OK
            // … setTrackState + eventBus.emit
        }
);
```

Rules, dependency map shapes (classes, nested injectables, plain functions), and exceptions (pure helpers, models, React, audio hot paths) live in §4.11 — do not duplicate them here.

---

## `Container` (bootstrap / class tokens)

`src/infra/di/Container.ts` is a sync registry for **singleton** values keyed by **class** or other `DependencyKey`s. Call **`Container.register(token, value)`** once at app startup — never inside a use case, store, or component. There is no `getInstance()`; import `Container` and use `register`, `get`, `set`, `clear` as defined in that module.

App wiring starts from **`src/app/registerDependencies.ts`** (imported first from **`src/app/bootstrap.ts`**). `inject()` resolves class tokens from the container when they appear in a dependency map; plain functions and module exports (repos, `eventBus`, nested injectables) are wired per §4.11.

### Tokens

Class constructors and symbols can be used as keys; see `Container.ts` and §4.11.

### Bootstrap ordering

`Container.get()` throws when a token has not been registered. Fix bootstrap order — do not work around an early read with module-top-level `Container.get()` in use-case or presentation files.

---

## Presentation layer (React)

Hooks and **views** **do not** use `inject()`. They subscribe to stores via contract barrels, call **public** use cases from contract paths, or receive `eventBus` / similar from app wiring. Leaf **components** should not subscribe to business stores or call use cases — keep that in views/hooks and pass props. If a hook must read the container, resolve **inside** `useEffect`, not at module scope (avoids ordering issues after minification). Prefer passing dependencies in from parents or using existing app singletons documented in §4.11.

---

## What is still open

> [!NOTE]
> **Error handling** — no single documented pattern for surfacing errors from use cases to callers; `Result`-style alignment with the native command boundary is a future direction.

> [!NOTE]
> **Internationalisation (i18n)** — not yet documented end-to-end.
