---
name: event-driven-communication
description: >
    Use when modules need to communicate without creating direct dependencies — emitting, subscribing to, or handling domain events. Covers defining typed DAW domain events using the project's DomainEvent abstract class, using EventBus to publish and subscribe, creating cross-module event flows, and subscribing from React hooks with proper cleanup. Apply even when the user says "notify another module", "react to a change", "trigger a side effect", "listen for an update", "invalidate cache after mutation", or "cross-module communication".
---

## Setup

The project ships `DomainEvent<TPayload>` (abstract class) and `EventBus` in `src/helpers/Event/`. All domain events must extend `DomainEvent`. The `createEventBus` factory is inject-based and should be called once at app bootstrap.

```ts
// src/helpers/Event/DomainEvent.ts (reference — do not modify)
abstract class DomainEvent<TPayload = unknown> {
    get payload(): TPayload   // read-only payload
    get timestamp(): number   // Date.now() at construction time
}
```

```ts
// src/helpers/Event/EventBus.ts (reference — do not modify)
class EventBus {
    on<TEvent extends typeof DomainEvent<unknown>>(
        event: TEvent,
        handler: (event: InstanceType<TEvent>) => void
    ): () => void  // returns unsubscribe

    emit(event: DomainEvent<unknown>): void
}
```

```ts
// src/modules/Track/events/TrackAddedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

type TrackAddedPayload = {
    trackId: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus';
};

export class TrackAddedEvent extends DomainEvent<TrackAddedPayload> {}
```

```ts
// src/modules/Track/events/TrackRemovedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

type TrackRemovedPayload = {
    trackId: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus';
};

export class TrackRemovedEvent extends DomainEvent<TrackRemovedPayload> {}
```

```ts
// src/modules/Transport/events/TempoChangedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

type TempoChangedPayload = {
    previousBpm: number;
    newBpm: number;
};

export class TempoChangedEvent extends DomainEvent<TempoChangedPayload> {}
```

```ts
// src/app/eventBus.ts — create the singleton at bootstrap
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { createEventBus } from '#/helpers/Event/createEventBus';
import { EventLog } from '#/helpers/Event/EventLog';

// createEventBus is inject-based: it resolves getEventLoggingEnabled from the Container
// and returns DevToolsEventBus in development, EventBus in production.
// Must be called after Logger is registered in the Container.
const eventLog = new EventLog();

export const eventBus = createEventBus(
    Container.getInstance().get(Logger),
    eventLog,
);
```

## Core Patterns

### Defining a domain event

```ts
// src/modules/Clip/events/ClipMovedEvent.ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

type ClipMovedPayload = {
    clipId: string;
    trackId: string;
    previousStartSeconds: number;
    newStartSeconds: number;
};

// The class itself IS the event type key — no string constants needed.
export class ClipMovedEvent extends DomainEvent<ClipMovedPayload> {}
```

One class per event. The class constructor is the type discriminant. No string event names are needed.

### Emitting events from a use case

```ts
// src/modules/Track/useCases/addTrack.ts
import { eventBus } from '#/app/eventBus';
import { TrackAddedEvent } from '../events/TrackAddedEvent';
import { createTrackApi } from '../repositories/createTrackApi';
import type { Track } from '../models/Track';

type AddTrackInput = {
    projectId: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus';
};

export const addTrack = async (input: AddTrackInput): Promise<Track> => {
    const track = await createTrackApi(input);

    // Emit an instance — EventBus dispatches based on the constructor class
    eventBus.emit(new TrackAddedEvent({
        trackId: track.id,
        name: track.name,
        kind: track.kind,
    }));

    return track;
};
```

### Subscribing from a use case (non-React context)

```ts
// src/modules/Analytics/useCases/registerAnalyticsHandlers.ts
import { eventBus } from '#/app/eventBus';
import { TrackAddedEvent } from '#/modules/Track/events/TrackAddedEvent';
import { TrackRemovedEvent } from '#/modules/Track/events/TrackRemovedEvent';
import { TempoChangedEvent } from '#/modules/Transport/events/TempoChangedEvent';

export const registerAnalyticsHandlers = (): (() => void) => {
    const unsubscribers = [
        // First argument is the CLASS — EventBus uses it as the handler map key
        eventBus.on(TrackAddedEvent, (event) => {
            // event.payload is fully typed as TrackAddedPayload
            trackTrackCreated(event.payload.trackId, event.payload.kind);
        }),
        eventBus.on(TrackRemovedEvent, (event) => {
            trackTrackDeleted(event.payload.trackId);
        }),
        eventBus.on(TempoChangedEvent, (event) => {
            trackTempoChange(event.payload.previousBpm, event.payload.newBpm);
        }),
    ];

    return () => {
        unsubscribers.forEach((fn) => fn());
    };
};
```

Register cross-module handlers at app startup (e.g., inside `main.tsx` or a root initialisation function), not inside React component mounts.

### Subscribing in a React hook with cleanup

```ts
// src/modules/Track/presentations/hooks/useTrackAddedSubscription.ts
import { useEffect, useEffectEvent } from 'react';
import { eventBus } from '#/app/eventBus';
import { TrackAddedEvent } from '../../events/TrackAddedEvent';

type TrackAddedPayload = InstanceType<typeof TrackAddedEvent>['payload'];

export const useTrackAddedSubscription = (onTrackAdded: (payload: TrackAddedPayload) => void) => {
    // useEffectEvent captures the latest callback without adding it to the
    // dependency array — prevents re-subscribing when the callback changes
    const handleTrackAdded = useEffectEvent(onTrackAdded);

    useEffect(() => {
        return eventBus.on(TrackAddedEvent, (event) => {
            handleTrackAdded(event.payload);
        });
    }, []);
};
```

### Cache invalidation in response to events

```ts
// src/modules/Track/useCases/registerTrackQueryHandlers.ts
import { getQueryClient } from '#/app/queryClient';
import { eventBus } from '#/app/eventBus';
import { TrackAddedEvent } from '../events/TrackAddedEvent';
import { TrackRemovedEvent } from '../events/TrackRemovedEvent';
import { useTracks } from '../presentations/hooks/useTracks';

export const registerTrackQueryHandlers = (): (() => void) => {
    const queryClient = getQueryClient();

    const unsubscribers = [
        eventBus.on(TrackAddedEvent, () => {
            queryClient.invalidateQueries({ queryKey: useTracks.getKey });
        }),
        eventBus.on(TrackRemovedEvent, () => {
            queryClient.invalidateQueries({ queryKey: useTracks.getKey });
        }),
    ];

    return () => unsubscribers.forEach((fn) => fn());
};
```

### Cross-module communication: AudioEngine → UI

```ts
// src/modules/AudioEngine/useCases/startTransport.ts
import { eventBus } from '#/app/eventBus';
import { TransportStartedEvent } from '#/modules/Transport/events/TransportStartedEvent';

export const startTransport = async (): Promise<void> => {
    await audioEngine.play();

    eventBus.emit(new TransportStartedEvent({
        positionSeconds: audioEngine.getPosition(),
    }));
};
```

```ts
// src/modules/Transport/presentations/hooks/useTransportStartedSubscription.ts
import { useEffect, useEffectEvent } from 'react';
import { eventBus } from '#/app/eventBus';
import { TransportStartedEvent } from '../../events/TransportStartedEvent';

type Payload = InstanceType<typeof TransportStartedEvent>['payload'];

export const useTransportStartedSubscription = (onStart: (payload: Payload) => void) => {
    const handleStart = useEffectEvent(onStart);

    useEffect(() => {
        return eventBus.on(TransportStartedEvent, (event) => handleStart(event.payload));
    }, []);
};
```

The AudioEngine module emits events via the shared bus. The UI subscribes through hooks with proper cleanup. Neither side imports from the other's internals.

## Common Mistakes

### CRITICAL Using strings as event keys instead of classes

Wrong:

```ts
eventBus.emit('track:added', { trackId: '123' }); // string-based — not the real API
eventBus.on('track:added', handler);
```

Correct:

```ts
eventBus.emit(new TrackAddedEvent({ trackId: '123', name: 'Kick', kind: 'audio' }));
eventBus.on(TrackAddedEvent, (event) => handler(event.payload));
```

The real `EventBus` uses the class constructor as the handler map key. Strings are not supported.

### CRITICAL Emitting a plain object instead of a class instance

Wrong:

```ts
eventBus.emit({ type: 'TrackAdded', trackId: '123' });
```

Correct:

```ts
eventBus.emit(new TrackAddedEvent({ trackId: '123', name: 'Kick', kind: 'audio' }));
```

`EventBus.emit` resolves the handler set using `event.constructor`. Plain objects have `Object` as their constructor and will never match registered handlers.

### CRITICAL Creating DomainEvent instances as plain types instead of classes

Wrong:

```ts
type TrackAddedEvent = {
    trackId: string;
    name: string;
};
```

Correct:

```ts
import { DomainEvent } from '#/helpers/Event/DomainEvent';

export class TrackAddedEvent extends DomainEvent<{ trackId: string; name: string }> {}
```

Domain events must be classes that extend `DomainEvent<TPayload>`. The class itself acts as the type discriminant in the EventBus handler map.

### CRITICAL Subscribing without returning the unsubscribe function from useEffect

Wrong:

```tsx
useEffect(() => {
    eventBus.on(TrackAddedEvent, handler);
}, []);
```

Correct:

```tsx
useEffect(() => {
    return eventBus.on(TrackAddedEvent, handler); // on() returns unsubscribe
}, []);
```

Failing to return the unsubscribe function causes memory leaks and stale handlers after the component unmounts.

### HIGH Subscribing in React without useEffectEvent

Wrong:

```tsx
export const useTrackAddedSubscription = (onTrackAdded: (payload: TrackAddedPayload) => void) => {
    useEffect(() => {
        // onTrackAdded captured in closure — stale if the prop changes
        return eventBus.on(TrackAddedEvent, (event) => onTrackAdded(event.payload));
    }, []); // missing dependency — stale closure
};
```

Correct:

```tsx
export const useTrackAddedSubscription = (onTrackAdded: (payload: TrackAddedPayload) => void) => {
    const handleTrackAdded = useEffectEvent(onTrackAdded);

    useEffect(() => {
        return eventBus.on(TrackAddedEvent, (event) => handleTrackAdded(event.payload));
    }, []); // stable — useEffectEvent always reads the latest callback
};
```

Wrap the callback in `useEffectEvent` (stable in React 19) to always get the latest version of the handler without re-subscribing on every render.

### HIGH Insufficient event payload context

Wrong:

```ts
export class TrackRemovedEvent extends DomainEvent<{ trackId: string }> {}
// subscriber must fetch track name separately after removal — but the track may already be gone
```

Correct:

```ts
export class TrackRemovedEvent extends DomainEvent<{
    trackId: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus';
}> {}
```

Payloads must contain enough context for every subscriber to act immediately without additional async lookups.
