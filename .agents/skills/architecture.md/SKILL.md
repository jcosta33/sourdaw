---
name: domain-architecture
description: >
    Apply when creating or refactoring modules. Enforces strict UI → Business → IO dependency flow, contract-based cross-module boundaries, pure TypeScript use cases, and DAW-specific module patterns. Apply even when the user says "create a module", "refactor", "use case", "repository", "where does this logic go", "domain error", or "cross-module".
---

## Setup

```typescript
// src/modules/Track/useCases/getTrackById.ts
import { getTrackByIdApi } from '../repositories/getTrackByIdApi';
import { TrackNotFoundError } from '../errors/TrackNotFoundError';
import type { Track } from '../models/Track';

type GetTrackByIdOutput = Promise<Track>;

export const getTrackById = async (id: string, signal?: AbortSignal): GetTrackByIdOutput => {
    const data = await getTrackByIdApi(id, signal);

    if (!data) {
        throw new TrackNotFoundError(id);
    }

    return data;
};
```

## Core Patterns

### Module structure

```
src/modules/
├── AudioEngine/
│   ├── models/          ← domain types: AudioEngine, TransportState, AudioNode graph types
│   ├── useCases/        ← createAudioEngine, startTransport, setTrackGain, setMasterGain
│   ├── repositories/    ← createWebAudioEngine, createGainWorkletNode
│   └── errors/          ← AudioEngineNotReadyError
│
├── Track/
│   ├── models/          ← Track, TrackKind
│   ├── useCases/        ← addTrack, getTrackById, removeTrack, renameTrack
│   ├── repositories/    ← createTrackApi, getTrackByIdApi, deleteTrackApi
│   ├── events/          ← TrackAddedEvent, TrackRemovedEvent (event types + name constants)
│   ├── errors/          ← TrackNotFoundError
│   └── presentations/
│       ├── hooks/       ← useTracks, useAddTrack, useRemoveTrack
│       ├── views/       ← TrackListView, TrackDetailView
│       └── components/  ← TrackRow, TrackControls, TrackNameInput
│
├── Command/
│   ├── models/          ← AppAction union type
│   └── useCases/        ← executeAppAction
│
└── Transport/
    ├── models/          ← TransportState
    ├── useCases/        ← startTransport, stopTransport, setTempo
    ├── events/          ← TempoChangedEvent, TransportStartedEvent
    ├── errors/          ← InvalidTempoError
    └── presentations/
        ├── hooks/       ← useTransportState, useSetTempo
        ├── views/       ← TransportBar
        └── components/  ← PlayButton, TempoDisplay
```

The dependency flow is always: `presentations → useCases → repositories`. No layer may import from a layer below it in the same direction.

### Domain errors

```typescript
// src/modules/Track/errors/TrackNotFoundError.ts
import { AppError } from '#/helpers/Errors/AppError';

// AppError extends Error and automatically sets this.name = this.constructor.name
export class TrackNotFoundError extends AppError {
    constructor(readonly trackId: string) {
        super(`Track ${trackId} not found`);
    }
}

// src/modules/Transport/errors/InvalidTempoError.ts
import { AppError } from '#/helpers/Errors/AppError';

export class InvalidTempoError extends AppError {
    constructor(readonly bpm: number) {
        super(`Tempo ${bpm} BPM is outside the valid range (20–300)`);
    }
}
```

All domain errors must extend `AppError` (from `src/helpers/Errors/AppError.ts`), not `Error` directly. `AppError` automatically sets `this.name = this.constructor.name`, so you never need to set `readonly name` manually. Callers import the error class from the `errors/` folder (the public contract) and use `instanceof` checks.

### Cross-module DTOs via useCases exports

```typescript
// src/modules/AudioEngine/useCases/getEngineStatus.ts
import type { AudioEngine } from '../models/AudioEngine';

export type AudioEngineStatusDto = {
    isReady: boolean;
    sampleRate: number;
    latencyHint: AudioContextLatencyCategory;
};

export const getEngineStatus = (engine: AudioEngine): AudioEngineStatusDto => ({
    isReady: engine.context.state === 'running',
    sampleRate: engine.context.sampleRate,
    latencyHint: engine.latencyHint,
});

// src/modules/Command/useCases/executeAppAction.ts
// Command module uses AudioEngine use cases — never AudioEngine internals
import { startTransport } from '#/modules/AudioEngine/useCases/startTransport';
import { setMasterGain } from '#/modules/AudioEngine/useCases/setMasterGain';
import type { AppAction } from '../models/AppAction';

export const executeAppAction = async (action: AppAction): Promise<void> => {
    switch (action.type) {
        case 'togglePlayback':
            return startTransport();
        case 'setMasterGain':
            return setMasterGain(action.payload.gain);
    }
};
```

When a use case is consumed by another module, export an explicit DTO type from the `useCases/` folder. Never import from another module's `models/` or `repositories/`.

### Injectable use cases with external dependencies

When a use case depends on other injectable functions (repositories, services, or other use cases resolved from the Container), use `inject` from `#/helpers/DependencyInjector/inject`.

```typescript
// src/modules/Track/useCases/addTrack.ts
import { inject } from '#/helpers/DependencyInjector/inject';
import { createTrackApi } from '../repositories/createTrackApi';
import { eventBus } from '#/app/eventBus';
import { TrackAddedEvent } from '../events/TrackAddedEvent';
import type { Track } from '../models/Track';

type AddTrackInput = { projectId: string; name: string; kind: 'audio' | 'midi' | 'bus' };

export const addTrack = inject(
    { createTrackApi },
    ({ createTrackApi }) =>
        async (input: AddTrackInput): Promise<Track> => {
            const track = await createTrackApi(input);
            eventBus.emit(new TrackAddedEvent({ trackId: track.id, name: track.name, kind: track.kind }));
            return track;
        }
);
```

Key `inject` rules:
- `inject(dependencies, factory)` — `dependencies` is a record of injectables (class constructors or other injectable functions), `factory` receives the resolved instances and returns the actual function.
- The Container caches the resolved result by `Symbol(factory.name)`.
- **Never call `inject` inside a React hook or component** — it fails after minification.
- Dependencies are resolved synchronously from the Container — async deps are not supported.
- For simple use cases without external deps, plain functions are fine — no need for `inject`.

For testing, use `injectDependencies` from `#/helpers/Testing/injectDependencies` to register mocks before calling injectable functions.

### Presentations consuming use cases via hooks

```typescript
// src/modules/Transport/presentations/hooks/useSetTempo.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setTempo } from '../../useCases/setTempo';
import { useTransportState } from './useTransportState';

export const useSetTempo = () => {
    const queryClient = useQueryClient();

    const { mutateAsync: setTempoMutation, isPending } = useMutation({
        mutationFn: (bpm: number) => setTempo(bpm),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: useTransportState.getKey() });
        },
    });

    return { setTempo: setTempoMutation, isPending };
};
```

The presentation layer connects to business operations exclusively through framework-agnostic use cases. Hooks wrap them in TanStack Query primitives. Views and components never import repositories directly.

### AudioEngine module: engine state outside React

```typescript
// src/modules/AudioEngine/useCases/createAudioEngine.ts
export type AudioEngine = {
    initialize: () => Promise<void>;
    resume: () => Promise<void>;
    suspend: () => Promise<void>;
    setMasterGain: (value: number) => void;
    getTransportPosition: () => number;
    dispose: () => Promise<void>;
};

// src/modules/AudioEngine/repositories/createWebAudioEngine.ts
// The concrete implementation lives here — use cases only see the interface above.
```

The `AudioEngine` module is the only module that owns real-time audio state. Its implementation in `repositories/` creates the `AudioContext`, worklets, and node graph. Use cases expose stable typed operations. The presentation layer never touches `AudioContext` directly.

### Handling domain errors in use cases

```typescript
// src/modules/Clip/useCases/moveClip.ts
import { getTrackById } from '#/modules/Track/useCases/getTrackById';
import { TrackNotFoundError } from '#/modules/Track/errors/TrackNotFoundError';
import { moveClipApi } from '../repositories/moveClipApi';

export const moveClip = async (clipId: string, targetTrackId: string): Promise<void> => {
    try {
        await getTrackById(targetTrackId);
    } catch (error) {
        if (error instanceof TrackNotFoundError) {
            // Handle gracefully in the calling context
            throw error;
        }
        throw error;
    }

    await moveClipApi({ clipId, targetTrackId });
};
```

## Common Mistakes

### CRITICAL Cross-module imports from non-contract folders

Wrong:

```typescript
// src/modules/Command/useCases/executeTogglePlayback.ts
// Importing from AudioEngine internals — forbidden
import { audioContext } from '#/modules/AudioEngine/repositories/createWebAudioEngine';

export const executeTogglePlayback = async (): Promise<void> => {
    if (audioContext.state === 'running') {
        await audioContext.suspend();
    } else {
        await audioContext.resume();
    }
};
```

Correct:

```typescript
// src/modules/Command/useCases/executeTogglePlayback.ts
import { startTransport } from '#/modules/AudioEngine/useCases/startTransport';
import { stopTransport } from '#/modules/AudioEngine/useCases/stopTransport';

export const executeTogglePlayback = async (isPlaying: boolean): Promise<void> => {
    if (isPlaying) {
        return stopTransport();
    }
    return startTransport();
};
```

Cross-module access must go through `useCases/`, `events/`, or `errors/`. Importing directly from another module's `repositories/` or `models/` creates tight coupling and bypasses business rules.

### CRITICAL Presentation layer bypassing the business layer

Wrong:

```typescript
// src/modules/Transport/presentations/views/TempoDisplay.tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { getTransportStateApi } from '#/modules/Transport/repositories/getTransportStateApi';

export const TempoDisplay = (): ReactElement => {
    const { data } = useSuspenseQuery({
        queryKey: ['transportState'],
        queryFn: () => getTransportStateApi(), // repository bypassed the use case
    });
    return <span>{data.bpm} BPM</span>;
};
```

Correct:

```typescript
// src/modules/Transport/presentations/hooks/useTransportState.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getTransportState } from '../../useCases/getTransportState'; // use case

export const useTransportState = () => {
    const { data: transportState } = useSuspenseQuery({
        queryKey: useTransportState.getKey(),
        queryFn: () => getTransportState(),
    });
    return { transportState };
};

useTransportState.getKey = () => ['transportState'];
```

Views and components must never import repositories. The required path is `presentations → useCases → repositories`.

### HIGH Leaking implementation types across module boundaries

Wrong:

```typescript
// src/modules/Command/useCases/applyPreset.ts
// Leaking AudioContext directly across the module boundary
import type { AudioContext } from 'web-audio-api';
import { getAudioContext } from '#/modules/AudioEngine/repositories/createWebAudioEngine';

export const applyPreset = async (presetId: string): Promise<void> => {
    const ctx: AudioContext = getAudioContext();
    // ...
};
```

Correct:

```typescript
// src/modules/Command/useCases/applyPreset.ts
import { loadPreset } from '#/modules/AudioEngine/useCases/loadPreset';

export const applyPreset = async (presetId: string): Promise<void> => {
    await loadPreset(presetId);
};
```

Use cases in one module should receive and return domain types or DTOs, not framework or infrastructure types (`AudioContext`, `AudioNode`, `WebAssembly.Instance`, etc.) from another module's internals.

### HIGH Putting business logic in React hooks

Wrong:

```tsx
// src/modules/Transport/presentations/hooks/useSetTempo.ts
export const useSetTempo = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (bpm: number) => {
            if (bpm < 20 || bpm > 300) throw new Error('Invalid tempo');
            await invoke('set_tempo', { bpm }); // business logic inside the hook
            queryClient.invalidateQueries({ queryKey: ['transportState'] });
        },
    });
};
```

Correct:

```typescript
// src/modules/Transport/useCases/setTempo.ts
import { InvalidTempoError } from '../errors/InvalidTempoError';
import { setTempoApi } from '../repositories/setTempoApi';

export const setTempo = async (bpm: number): Promise<void> => {
    if (bpm < 20 || bpm > 300) {
        throw new InvalidTempoError(bpm);
    }
    await setTempoApi(bpm);
};

// src/modules/Transport/presentations/hooks/useSetTempo.ts
import { useMutation } from '@tanstack/react-query';
import { setTempo } from '../../useCases/setTempo';

export const useSetTempo = () => {
    const { mutateAsync } = useMutation({ mutationFn: setTempo });
    return { setTempo: mutateAsync };
};
```

Validation and business rules belong in use cases, not in React hooks. Hooks are only responsible for connecting use cases to React lifecycle and TanStack Query.
