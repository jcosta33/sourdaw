# State management

This document explains our approach to client-side state management for UI and domain state. For server state, use TanStack Query. For cross-domain UI updates, use [domain events](./04-events.md).

---

## Our approach to state

Our state management philosophy is to keep domain state in plain, framework-agnostic TypeScript stores, decoupling it from the UI. We connect these vanilla stores to React components only when needed using the `useSyncExternalStore` hook. This ensures clear boundaries, as components receive data via props from subscribing views or hooks rather than accessing stores directly. We reserve React Context for simple, localized UI state -- consumed via the `use()` hook (React 19) rather than `useContext`.

### The vanilla store

Our custom `Store` class (located at `src/helpers/Store/Store.ts`) provides a simple but powerful foundation for creating observable state containers. It is framework-agnostic and can be used anywhere in the application.

---

## Cross-module store contracts

Business-layer stores (located at `ModuleName/stores/`, outside `presentations/`) are **cross-module contracts**. Any module may import and subscribe to them — both from use cases (for reading/writing) and from presentation hooks (for reactive UI binding via `useSyncExternalStore`).

Presentation-layer stores (located at `ModuleName/presentations/stores/`) are **module-private**. They hold UI preferences (zoom, sidebar state, panel layout) and are never imported by another module.

```typescript
// ✅ Cross-module: import a business-layer store from another module
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

const tracks = useSyncExternalStore(
    (cb) => trackStore.subscribe(cb),
    () => trackStore.value?.tracks ?? []
);

// ❌ Forbidden: import a presentation-layer store from another module
import { zoomStore } from '#/modules/Arrangement/presentations/stores/zoomStore';
```

---

## How to create and use a store

This section provides a practical guide to creating, persisting, and subscribing to a store.

### 1. Define and create the store

A store is a singleton instance of the `Store<T>` class. It holds the state and provides methods to update and subscribe to it.

```typescript
// Workspace/stores/workspacePreferencesStore.ts

export type WorkspacePreferencesStore = {
    theme: 'light' | 'dark';
    defaultSampleRate: 44100 | 48000 | 96000;
    showMetrics: boolean;
};

let instance: Store<WorkspacePreferencesStore>;

export function getWorkspacePreferencesStore(): Store<WorkspacePreferencesStore> {
    if (!instance) {
        const logger = Container.getInstance().get(Logger);
        instance = new Store<WorkspacePreferencesStore>(logger, {
            initialData: {
                theme: 'dark',
                defaultSampleRate: 48000,
                showMetrics: false,
            },
        });
    }
    return instance;
}
```

### 2. Connect the store to React with a hook

Create a custom hook that uses `useSyncExternalStore` to subscribe to your store instance. This hook will provide the component with the current state and trigger re-renders when the state changes.

```tsx
// Workspace/presentations/hooks/useWorkspacePreferences.ts

import { useSyncExternalStore } from 'react';

import { getWorkspacePreferencesStore, type WorkspacePreferencesStore } from '../stores/workspacePreferencesStore';

export const useWorkspacePreferences = (): WorkspacePreferencesStore => {
    const store = getWorkspacePreferencesStore();
    const state = useSyncExternalStore(store.subscribe, store.get, store.get);
    return state;
};
```

### 3. Persist store state (optional)

To persist state to `localStorage`, inject a `LocalStorageStorage` instance when creating your store. This is the only permitted way to interact with `localStorage`.

```typescript
// Workspace/stores/dawLayoutStore.ts

const LAYOUT_STORAGE_KEY = 'daw-layout-state';

export type LayoutState = 'arrange' | 'mixer' | 'piano-roll';

let layoutStoreInstance: Store<LayoutState>;

export function getDawLayoutStore(initialState: LayoutState): Store<LayoutState> {
    if (!layoutStoreInstance) {
        const logger = Container.getInstance().get(Logger);
        const storage = new LocalStorageStorage<LayoutState>(LAYOUT_STORAGE_KEY);
        const storedValue = storage.get();
        layoutStoreInstance = new Store<LayoutState>(logger, {
            initialData: storedValue ?? initialState,
            storage,
        });
    }
    return layoutStoreInstance;
}
```

### 4. Update the store in response to events

Stores are often updated in response to domain events. Subscribe to an event and call the store's `update` method, which passes the current value to your updater and writes the result back atomically. Prefer `update` over `set({ ...store.value, ... })` — it removes the read-then-write gap and makes intent explicit.

```typescript
// Workspace/useCases/handleMetricsToggled.ts

getEventBus().on(MetricsToggledEvent, (event) => {
    const store = getWorkspacePreferencesStore();

    store.update((current) => (current ? { ...current, showMetrics: event.payload.isEnabled } : current));
});
```

Use `set` directly when you are replacing the value wholesale (e.g., loading from persistence), and `clear()` to remove it entirely.

### 5. Use React Context with `use()` (React 19)

For simple, localized UI state that doesn't warrant a full store, React Context remains appropriate. In React 19, consume context with the `use()` hook instead of `useContext`. The `use()` hook can be called conditionally and also reads Promises for Suspense-based patterns.

```tsx
// Common/presentations/context/PanelContext.ts

import { createContext } from 'react';

type PanelContextValue = {
    isCollapsed: boolean;
    toggle: () => void;
};

export const PanelContext = createContext<PanelContextValue | null>(null);
```

```tsx
// Common/presentations/components/PanelHeader.tsx

import { type ReactElement, use } from 'react';

import { PanelContext } from '../context/PanelContext';

export const PanelHeader = ({ title }: { title: string }): ReactElement => {
    const panel = use(PanelContext);

    if (!panel) {
        return <header>{title}</header>;
    }

    return (
        <header>
            <span>{title}</span>
            <button onClick={panel.toggle}>{panel.isCollapsed ? 'Expand' : 'Collapse'}</button>
        </header>
    );
};
```

---

## Read-only stores

For state that is fetched from an external source and is not mutated on the client (e.g., user permissions, session data), a `ReadonlyStore` is available. It follows the same principles as the standard `Store` but with a few key differences:

- It is created via an asynchronous `ReadonlyStore.create()` method.
- It requires a `getDataFn` for fetching and refreshing its data.
- It does not have a `set()` method, enforcing a strict read-only pattern.

The setup is analogous to the standard `Store`, using a singleton getter and a React hook for component subscriptions.
