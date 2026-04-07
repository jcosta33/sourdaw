# Dependency Injection

The `Container` class (at `src/infra/di/Container.ts`) is a lightweight singleton registry that decouples business-layer code from its collaborators. It is the only supported way to share long-lived service instances across modules.

---

## Core concepts

### Tokens

A token is the key used to register and retrieve a dependency. Two forms are supported:

```typescript
// Class constructor — preferred for class instances
Container.getInstance().get(Logger);

// Symbol — use for non-class dependencies (functions, config objects, etc.)
const MY_TOKEN = Symbol('MyToken');
Container.getInstance().get(MY_TOKEN);
```

### Lifecycle

All dependencies registered in the Container are **singletons**. `register` overwrites any previous value for the same token. `get` always returns the same instance for the lifetime of the app.

---

## How to register a dependency

All registrations happen at bootstrap time — before any module code runs. Add your registration to the app's bootstrap file:

```typescript
// src/app/bootstrap.ts

import { Container } from '#/infra/di/Container';
import { Logger } from '#/helpers/Logger/Logger';

const container = Container.getInstance();

container.register(Logger, new Logger());
// EventBus is created via createEventBus<AppEvents>() in registerDependencies.ts — not a Container registration
```

> [!IMPORTANT]
> Never call `register` inside a use case, store, or component. Bootstrap is the only place registrations belong.

---

## How to consume a dependency

Resolve dependencies **at module scope**, outside any function body. This ensures the dependency is available as soon as the module is loaded and avoids repeated lookups on every call:

```typescript
// Arrangement/useCases/addTrack.ts

import { Container } from '#/infra/di/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { eventBus } from '#/app/bootstrap';

const logger = Container.getInstance().get(Logger);

export function addTrack({ name, kind }: AddTrackInput): Track | null {
    const state = getTrackState();
    if (!state) return null;

    const track = createTrack({ name, kind });
    setTrackState({ ...state, tracks: [...state.tracks, track], selectedTrackId: track.id });

    eventBus.emit('track.added', { trackId: track.id, name: track.name, kind: track.kind });
    logger.info(`Track added: ${track.id}`);

    return track;
}
```

The same pattern applies to repositories, stores, and any other business-layer file.

---

## Using the Container in React hooks

> [!WARNING]
> Resolve dependencies with `Container.getInstance()` inside the `useEffect` body, not at module scope for hook files. Module-scope resolution in a hook file can cause issues after minification where the module is evaluated before bootstrap runs.

```typescript
// Workspace/presentations/hooks/useFlagSubscription.ts
import { useEffect, useEffectEvent } from 'react';
import { eventBus } from '#/app/bootstrap';

export const useFlagSubscription = (callback: () => void) => {
    const onFlagsFetched = useEffectEvent(callback);

    useEffect(() => {
        const unsubscribe = eventBus.on('flags.fetched', () => {
            onFlagsFetched();
        });

        return () => {
            unsubscribe();
        };
    }, []);
};
```

---

## Lazy proxy behaviour

If `get` is called before a dependency is registered (e.g. during code-split chunk evaluation before bootstrap completes), the Container returns a **lazy proxy** instead of throwing. The proxy defers all property access until the real instance is registered.

This is transparent in practice — it only matters if a module resolves a dependency at import time and immediately invokes it before bootstrap has finished. In that case you will see a console warning:

```
[Container] Dependency "EventBus" not yet registered, call to .emit ignored
```

If you see this warning, verify your bootstrap order.

---

## Testing

In tests, use `vi.mock` to substitute the concrete dependency at the module level — this is simpler than registering overrides in the Container:

```typescript
// Arrangement/useCases/addTrack.spec.ts

import { addTrack } from './addTrack';

vi.mock('#/app/bootstrap', () => ({
    eventBus: { emit: vi.fn().mockResolvedValue(undefined), on: vi.fn() },
}));

describe('addTrack', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should emit track.added after successful creation', () => {
        const result = addTrack({ name: 'Drums', kind: 'audio' });

        expect(eventBus.emit).toHaveBeenCalledWith('track.added', expect.objectContaining({ name: 'Drums' }));
    });
});
```

If a test genuinely needs to replace a Container registration (e.g. to test bootstrap logic), use `container.reset()` in `afterEach` to avoid state leaking between tests:

```typescript
import { Container } from '#/infra/di/Container';

afterEach(() => {
    Container.getInstance().reset();
});
```

---

## What is currently missing

> [!NOTE]
> **Error handling** — there is no documented or enforced pattern for how use cases should surface errors to callers. Throwing exceptions is common but inconsistent. A `Result<T, E>` pattern (e.g. via `neverthrow`) has been identified as the target direction, aligning with how Rust Tauri commands return `Result`. This has not yet been implemented.

> [!NOTE]
> **Internationalisation (i18n)** — `t('key')` calls appear throughout the codebase but there is no documentation covering which library is in use, how to add a new translation key, how catalogs are structured, or how to ensure type safety for keys. `react-i18next` has been identified as the target library. This has not yet been documented.
