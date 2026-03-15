---
name: state-management
description: >
    Use when working with any form of state: fetching or caching async data, managing global or local UI state, persisting preferences, or deriving values from props and stores. Covers TanStack Query for async state, the project's Store and ReadonlyStore classes for UI state (connected to React via useSyncExternalStore), audio engine state ownership, and derived state computed at render time. Apply even when the user says "fetch data", "global state", "cache", "persist", "sidebar", "workspace mode", "panel", or "React state".
---

## Setup

The project ships `Store<T>` and `ReadonlyStore<T>` in `src/helpers/Store/`. Use them for all client-side UI state. Do not install third-party state libraries.

```ts
// src/modules/Workspace/stores/workspaceStore.ts
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { MemoryStorage } from '#/helpers/Store/Storage/MemoryStorage';

export type WorkspaceMode = 'arrange' | 'mixer' | 'piano-roll';

type WorkspaceState = {
    mode: WorkspaceMode;
    isSidebarOpen: boolean;
    isInspectorOpen: boolean;
};

const defaultState: WorkspaceState = {
    mode: 'arrange',
    isSidebarOpen: true,
    isInspectorOpen: true,
};

// Stores are module-level singletons — never create them inside a hook or component.
// Logger must already be registered in the Container before this module loads.
export const workspaceStore = new Store<WorkspaceState>(
    Container.getInstance().get(Logger),
    {
        storage: new MemoryStorage(),
        initialData: defaultState,
    },
);
```

```ts
// src/modules/Workspace/presentations/hooks/useWorkspace.ts
import { useSyncExternalStore } from 'react';
import { workspaceStore, type WorkspaceMode } from '../../stores/workspaceStore';

const defaultState = workspaceStore.value!;

export const useWorkspace = () => {
    // Store.subscribe passes value to the callback, but useSyncExternalStore
    // wants a zero-argument notifier. Adapt with an arrow wrapper.
    const state = useSyncExternalStore(
        (onChange) => workspaceStore.subscribe(() => onChange()),
        () => workspaceStore.value ?? defaultState,
        () => workspaceStore.value ?? defaultState,
    );

    return {
        mode: state.mode,
        setMode: (mode: WorkspaceMode) =>
            workspaceStore.set({ ...workspaceStore.value!, mode }),
        isSidebarOpen: state.isSidebarOpen,
        toggleSidebar: () =>
            workspaceStore.set({ ...workspaceStore.value!, isSidebarOpen: !workspaceStore.value!.isSidebarOpen }),
        isInspectorOpen: state.isInspectorOpen,
        toggleInspector: () =>
            workspaceStore.set({ ...workspaceStore.value!, isInspectorOpen: !workspaceStore.value!.isInspectorOpen }),
    };
};
```

TanStack Query for async state:

```ts
// src/modules/Project/presentations/hooks/useProjectSuspense.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getProject } from '../useCases/getProject';

export const useProjectSuspense = (id: string) => {
    const { data: project } = useSuspenseQuery({
        queryKey: useProjectSuspense.getKey(id),
        queryFn: ({ signal }) => getProject(id, signal),
    });

    return { project };
};

useProjectSuspense.getKey = (id: string) => ['project', id];
```

## Core Patterns

### Store class API

```ts
// src/helpers/Store/Store.ts (reference — do not modify)
class Store<TDataSchema> {
    get value(): TDataSchema | null          // read current value
    set(value: TDataSchema | null): void     // replace full value, notify subscribers
    subscribe(callback: (value: TDataSchema | null) => void): () => void  // returns unsubscribe
    clear(): void                            // sets value to null, notifies subscribers
}
```

Important: `set()` replaces the **entire** value. For partial updates, spread the current value:

```ts
workspaceStore.set({ ...workspaceStore.value!, mode: 'mixer' });
```

### Connecting a Store to React

`Store.subscribe` passes the value to its callback. `useSyncExternalStore` expects a zero-argument notifier. Always adapt with an arrow wrapper:

```ts
useSyncExternalStore(
    (onChange) => store.subscribe(() => onChange()),  // adapter
    () => store.value ?? fallback,
    () => store.value ?? fallback,
);
```

### Persisted store (localStorage)

New localStorage keys must be added to `src/helpers/Store/Storage/LocalStorageKeys.ts` as a string literal in the `LocalStorageKey` union — one per key, with a comment explaining its purpose.

```ts
// src/helpers/Store/Storage/LocalStorageKeys.ts — add your keys here
export type LocalStorageKey =
    // ... existing keys ...

    // Stores the DAW workspace layout preferences
    | 'daw-workspace-preferences';
```

```ts
// src/modules/User/stores/userPreferencesStore.ts
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';

type UserPreferencesState = {
    theme: 'dark' | 'light';
    defaultSampleRate: 44100 | 48000 | 96000;
};

export const userPreferencesStore = new Store<UserPreferencesState>(
    Container.getInstance().get(Logger),
    {
        storage: new LocalStorageStorage('daw-workspace-preferences'),
        initialData: {
            theme: 'dark',
            defaultSampleRate: 48000,
        },
    },
);
```

### ReadonlyStore for externally-fetched data

Use `ReadonlyStore` for data that is fetched from an external source and never directly mutated by the client (feature flags, Tauri config, etc.).

```ts
// src/modules/Config/stores/dawConfigStore.ts
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { ReadonlyStore } from '#/helpers/Store/ReadonlyStore';
import { MemoryStorage } from '#/helpers/Store/Storage/MemoryStorage';
import { fetchDawConfig } from '../repositories/fetchDawConfig';

// ReadonlyStore.create is async — initialize during app bootstrap
export const createDawConfigStore = () =>
    ReadonlyStore.create<DawConfig>(Container.getInstance().get(Logger), {
        storage: new MemoryStorage(),
        getDataFn: () => fetchDawConfig(),
    });
```

`ReadonlyStore` has no `set()`. Call `.refresh()` to re-fetch. Connect to React with the same `useSyncExternalStore` adapter pattern.

### Audio engine state bridged into React

The audio engine is not a Store — it owns its own state. Expose it as a subscribe/getSnapshot pair for `useSyncExternalStore`.

```ts
// src/modules/AudioEngine/repositories/audioEngineStore.ts
// The engine publishes its TransportState to subscribers.
// This is NOT a Store<T> instance — the engine manages its own internal state.
export type AudioEngineStore = {
    subscribe: (onChange: () => void) => () => void;
    getSnapshot: () => TransportState;
};
```

```ts
// src/modules/Transport/presentations/hooks/useTransportState.ts
import { useSyncExternalStore } from 'react';
import { audioEngineStore } from '#/modules/AudioEngine/repositories/audioEngineStore';

export const useTransportState = () => {
    return useSyncExternalStore(
        audioEngineStore.subscribe,
        audioEngineStore.getSnapshot,
        audioEngineStore.getSnapshot,
    );
};
```

### Async state with TanStack Query

```ts
// src/modules/Track/presentations/hooks/useTracks.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getTracks } from '../useCases/getTracks';

type UseTracksParams = { projectId: string };

export const useTracks = ({ projectId }: UseTracksParams) => {
    const { data: tracks } = useSuspenseQuery({
        queryKey: useTracks.getKey({ projectId }),
        queryFn: ({ signal }) => getTracks({ projectId, signal }),
    });

    return { tracks };
};

useTracks.getKey = ({ projectId }: UseTracksParams) => ['tracks', projectId];
```

### Mutations

```ts
// src/modules/Track/presentations/hooks/useAddTrack.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addTrack } from '../useCases/addTrack';
import { useTracks } from './useTracks';

export const useAddTrack = (projectId: string) => {
    const queryClient = useQueryClient();

    const { mutateAsync, isPending } = useMutation({
        mutationFn: (name: string) => addTrack({ projectId, name }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: useTracks.getKey({ projectId }) });
        },
    });

    return { addTrack: mutateAsync, isPending };
};
```

### Derived state at render time

```tsx
export const TrackStatusBadge = ({ clipCount, isMuted }: Props): ReactElement => {
    const label = isMuted ? 'Muted' : clipCount > 0 ? `${clipCount} clips` : 'Empty';
    return <span>{label}</span>;
};
```

Compute derived values during rendering. The React Compiler memoizes them automatically.

## Common Mistakes

### CRITICAL Creating a Store inside a React hook or component

Wrong:

```tsx
const useWorkspace = () => {
    // Creates a new isolated store on every render
    const logger = Container.getInstance().get(Logger);
    const store = new Store(logger, { storage: new MemoryStorage(), initialData: ... });
    return useSyncExternalStore(...);
};
```

Correct:

```ts
// Store is defined at module level — one singleton shared across all consumers
export const workspaceStore = new Store<WorkspaceState>(logger, { ... });
```

### CRITICAL Forgetting the useSyncExternalStore adapter

Wrong:

```ts
// Store.subscribe passes value to callback — not compatible with useSyncExternalStore
useSyncExternalStore(
    workspaceStore.subscribe,  // type mismatch — passes value, onChange wants no args
    () => workspaceStore.value,
    () => workspaceStore.value,
);
```

Correct:

```ts
useSyncExternalStore(
    (onChange) => workspaceStore.subscribe(() => onChange()),
    () => workspaceStore.value ?? defaultState,
    () => workspaceStore.value ?? defaultState,
);
```

### CRITICAL Calling store.set() with only partial data

Wrong:

```ts
// Wipes out all other fields — Store.set replaces the full value
workspaceStore.set({ mode: 'mixer' });
```

Correct:

```ts
workspaceStore.set({ ...workspaceStore.value!, mode: 'mixer' });
```

### CRITICAL Putting audio engine state in React state

Wrong:

```tsx
const [position, setPosition] = useState(0);
useEffect(() => {
    const id = setInterval(() => setPosition(engine.getPosition()), 16);
    return () => clearInterval(id);
}, []);
```

Correct:

```tsx
const { positionSeconds } = useTransportState();
// backed by useSyncExternalStore against the engine's own store interface
```

### CRITICAL Using TanStack Query for UI-only state

Wrong:

```tsx
const { data: mode } = useQuery({ queryKey: ['workspaceMode'], queryFn: () => 'arrange' });
```

Correct:

```ts
const { mode } = useWorkspace(); // backed by workspaceStore + useSyncExternalStore
```

### CRITICAL Using useEffect for data fetching

Wrong:

```tsx
useEffect(() => { getTracks({ projectId }).then(setTracks); }, [projectId]);
```

Correct:

```tsx
const { tracks } = useTracks({ projectId }); // backed by useSuspenseQuery
```

### HIGH Using localStorage directly

Wrong:

```ts
localStorage.setItem('daw-workspace-preferences', JSON.stringify(state));
```

Correct:

```ts
userPreferencesStore.set({ ...userPreferencesStore.value!, theme: 'dark' });
// LocalStorageStorage writes automatically; uses superjson for serialization
```

### HIGH Manual useMemo/useCallback/React.memo

The React Compiler handles memoization automatically. Never add `useMemo`, `useCallback`, or `React.memo` manually.
