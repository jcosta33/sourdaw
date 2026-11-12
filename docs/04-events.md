# Events

Cross-module communication via domain events enables loose coupling. This guide explains how to define, publish, and subscribe to events. The event infrastructure lives in `src/infra/events/` and is built around `createEventBus<TEventMap>()` — a fully typed, functional event bus. Event payloads often inform cache invalidations or UI updates in [state management](./03-state-management.md).

## Core workflow

The process of using events follows three main steps:

1. **[Define an Event](#1-define-the-event)**: Define a typed payload in the app's `EventMap`.
2. **[Publish an Event](#2-publish-the-event)**: Emit the event from a use case after a business operation completes.
3. **[Subscribe to an Event](#3-subscribe-to-the-event)**: Listen for the event in other modules to trigger side effects, such as cache updates or analytics tracking.

---

## Inter-module communication

Domain events enable modules to communicate without direct dependencies:

```mermaid
graph TB
    A[Track Module] -->|TrackRemovedEvent| B[Event Bus]
    B --> C[Mixer Module]
    B --> D[AudioEngine Module]
    B --> E[Timeline Module]

    style B fill:#e8f5e9
```

**Benefits:**

- **Loose coupling**: Modules remain independent and testable
- **Framework agnostic**: Events work across different layers and technologies
- **Type safety**: Strong typing prevents communication errors
- **Asynchronous**: Non-blocking communication preserves performance
- **Extensibility**: New modules can subscribe without modifying existing code

## Event implementation

### 1. Define the event

Events are plain typed payloads defined in the app's `AppEvents` map. Each event is a string key mapped to a payload type.

#### Event map and payload definition

All event payloads are defined as plain types in module `events/` folders, then assembled into the central `AppEvents` map:

```typescript
// Arrangement/events/TrackRemovedEvent.ts
export type TrackRemovedPayload = { trackId: string };

// Arrangement/events/TrackSelectionChangedEvent.ts
export type TrackSelectionChangedPayload = { trackId: string | null; previousTrackId: string | null };

// app/registerDependencies.ts
import { createEventBus } from '#/infra/events/createEventBus';
import { type TrackRemovedPayload, type TrackSelectionChangedPayload } from '#/modules/Arrangement/events';

export type AppEvents = {
    'track.removed': TrackRemovedPayload;
    'track.selectionChanged': TrackSelectionChangedPayload;
};

export const eventBus = createEventBus<AppEvents>();
```

#### Event naming conventions

Use `noun.pastTense` dot-separated string keys for lifecycle events (some domains use `domain.verb`, e.g. `panel.showDevice`, `zoom.toFit`):

```typescript
// ✅ Clear, descriptive names (all real keys)
'track.removed';
'audioDevice.loaded';
'yeast.notesOff';

// ❌ Vague or unclear names
'transport';
'update';
'data.changed';
```

### 2. Publish the event

Publish events from business operations, typically at the end of a use case after the primary action has succeeded.

#### Publishing from use cases

```typescript
// Arrangement/useCases/publishTrackRemoved.ts — inject the module event bus token
import { inject } from '#/infra/di/inject';
import { type TrackRemovedPayload } from '../events/TrackRemovedEvent';
import { ArrangementEventBus } from './arrangementEventBus';

export const publishTrackRemoved = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function publishTrackRemoved(payload: TrackRemovedPayload): Promise<void> {
            return eventBus.emit('track.removed', payload);
        }
);
```

> [!IMPORTANT]
> `eventBus.emit()` returns `Promise<void>`. Return it, await it, or prefix it with `void` to satisfy `@typescript-eslint/no-floating-promises`.

When publishing events, ensure the payload contains sufficient, immutable context so that subscribers can act on the event without needing to make additional API calls to fetch related data.

### 3. Subscribe to the event

Subscribe to events in other domains to trigger side effects, such as updating a cache, sending analytics, or starting a new workflow. Handlers should be kept small and delegate any long-running or complex work to use cases.

#### Cross-module event handling

Subscribe to events from other domains. The `on()` method returns an unsubscribe function:

```typescript
// Illustrative — a module's subscriber file (real example: Toaster/useCases/toasterSubscriber.ts)

import { eventBus } from '#/app/bootstrap';

export function initMixerSubscribers(): () => void {
    const unsubscribe = eventBus.on('track.removed', (payload) => {
        // payload is typed as TrackRemovedPayload — no .payload wrapper
        const store = getMixerTracksStore();
        store.update((current) => (current ?? []).filter((track) => track.trackId !== payload.trackId));
    });

    return unsubscribe;
}
```

#### Creating reusable subscription helpers

For events that are frequently subscribed to, you can create a reusable helper function:

```ts
// Illustrative — hypothetical flags feature (no Common module exists)
import { eventBus } from '#/app/bootstrap';

type Callback = (flags: FlagsFetchedPayload) => void;

export function subscribeToFlagsFetchedEvent(callback: Callback): () => void {
    return eventBus.on('flags.fetched', (payload) => {
        callback(payload);
    });
}
```

> [!WARNING]
> Do not resolve Container dependencies at module scope in hook files — resolve them inside `useEffect` instead. Module-scope resolution in a hook file can evaluate before bootstrap has registered dependencies. See [dependency injection](./01-dependency-injection.md) for the full rule.

The following example illustrates the anti-pattern and its fix. Note the use of `useEffectEvent` (stable in React 19.2) to capture the latest callback without adding it to the Effect's dependency array, preventing unnecessary re-subscriptions:

```typescript
// Illustrative — hypothetical FeatureFlags module

// ❌ Bad: eventBus at module scope in a hook file
import { eventBus } from '#/app/bootstrap';

export const useFlagSubscription = (callback: () => void) => {
    useEffect(() => {
        return eventBus.on('flags.fetched', callback);
    }, [callback]);
};

// ✅ Good: useEffectEvent; bus from props / module wiring (not Container.getInstance())
import { useEffect, useEffectEvent } from 'react';

export const useFlagSubscription = (
    eventBus: { on: (type: string, cb: () => void) => () => void },
    callback: () => void
) => {
    const onFlagsFetched = useEffectEvent(callback);

    useEffect(() => {
        const unsubscribe = eventBus.on('flags.fetched', () => {
            onFlagsFetched();
        });

        return () => {
            unsubscribe();
        };
    }, [eventBus]);
};
```

`useEffectEvent` always sees the latest `callback` value without causing the Effect to re-run. This eliminates stale closure bugs and avoids unnecessary teardown/setup cycles when the callback reference changes.

#### Event handler organization

Structure event handlers for maintainability. Each registration function returns an unsubscribe callback:

```typescript
// AiRuntime/useCases/registerAiEventHandlers.ts

import { eventBus } from '#/app/bootstrap';

export function registerAiEventHandlers(): () => void {
    const unsubs = [
        eventBus.on('track.removed', removeAiTrackContext),
        eventBus.on('track.selectionChanged', handleSelectionChange),
        eventBus.on('audioDevice.loaded', analyzeNewDeviceParameters),
    ];

    return () => unsubs.forEach((unsub) => unsub());
}
```

## Testing event flows

For a complete guide on our testing philosophy and patterns, see the [testing](./06-testing.md) documentation. The following examples show patterns specific to event-driven architectures.

The infra provides test helpers in `#/infra/events/testing/`:

- `recordEvents(bus)` — records all events emitted on the bus; access `.entries` to inspect

### Event handler testing

Test event handlers in isolation using `createEventBus()`:

```typescript
// Mixer/useCases/__tests__/trackEventHandlers.spec.ts
import { createEventBus } from '#/infra/events/createEventBus';

describe('initMixerSubscribers', () => {
    it('should drop the mixer row when track.removed fires', async () => {
        const bus = createEventBus<AppEvents>();
        // wire up the subscriber against the test bus
        initMixerSubscribers(bus);

        await bus.emit('track.removed', { trackId: 'track-456' });

        expect(getMixerTracksStore().value).not.toContainEqual(expect.objectContaining({ trackId: 'track-456' }));
    });
});
```

### Event publishing testing

Test event publishing from use cases using `recordEvents`:

```typescript
// Arrangement/useCases/__tests__/publishTrackRemoved.spec.ts
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createEventBus } from '#/infra/events/createEventBus';
import { recordEvents } from '#/infra/events/testing/recordEvents';

describe('publishTrackRemoved', () => {
    it('should emit track.removed with the removed track id', async () => {
        const bus = createEventBus<AppEvents>();
        const recorder = recordEvents(bus);
        injectDependencies(publishTrackRemoved, { eventBus: bus });

        await publishTrackRemoved({ trackId: 'track-1' });

        expect(recorder.entries).toContainEqual(
            expect.objectContaining({ event: 'track.removed', payload: { trackId: 'track-1' } })
        );
        recorder.stop();
    });
});
```

### Event payload guidelines

Include sufficient context for event handlers:

```typescript
// ✅ Event provides rich context, enabling subscribers to act without needing to perform additional lookups.
export type ProjectSettingsChangedPayload = {
    readonly projectId: string;
    readonly previousBpm: number;
    readonly newBpm: number;
    readonly sampleRate: number;
    readonly changedBy: string;
};

// ❌ Minimal context requires additional lookups
export type ProjectSettingsChangedPayload = {
    readonly projectId: string;
    readonly newBpm: number;
};
```
