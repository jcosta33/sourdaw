# State management

This document explains our approach to client-side state management for UI and domain state. For server state, use [TanStack Query](./data-fetching.md). For cross-domain UI updates, use [domain events](./events.md).

---

## Our approach to state

Our state management philosophy is to keep domain state in plain, framework-agnostic TypeScript stores, decoupling it from the UI. We connect these vanilla stores to React components only when needed using the `useSyncExternalStore` hook. This ensures clear boundaries, as components receive data via props from subscribing views or hooks rather than accessing stores directly. We reserve React Context for simple, localized UI state -- consumed via the `use()` hook (React 19) rather than `useContext`.

### The vanilla store

Our custom `Store` class (located at `src/helpers/Store/Store.ts`) provides a simple but powerful foundation for creating observable state containers. It is framework-agnostic and can be used anywhere in the application.

---

## How to create and use a store

This section provides a practical guide to creating, persisting, and subscribing to a store.

### 1. Define and create the store

A store is a singleton instance of the `Store<T>` class. It holds the state and provides methods to update and subscribe to it.

```typescript
// UserPreference/presentations/stores/userSettingsStore.ts

export type UserSettingsStore = {
    theme: 'light' | 'dark';
    language: string;
    featureFlags: Map<string, boolean>;
};

let instance: Store<UserSettingsStore>;

export function getUserSettingsStore(): Store<UserSettingsStore> {
    if (!instance) {
        const logger = Container.getInstance().get(Logger);
        instance = new Store<UserSettingsStore>(logger, {
            initialData: {
                theme: 'light',
                language: 'en',
                featureFlags: new Map(),
            },
        });
    }
    return instance;
}
```

### 2. Connect the store to React with a hook

Create a custom hook that uses `useSyncExternalStore` to subscribe to your store instance. This hook will provide the component with the current state and trigger re-renders when the state changes.

```tsx
// UserPreference/presentations/hooks/useUserPreferences.ts

import { useSyncExternalStore } from 'react';

import { getUserPreferencesStore, type UserPreferencesStore } from '../stores/userPreferencesStore';

export const useUserPreferences = (): UserPreferencesStore => {
    const store = getUserPreferencesStore();
    const state = useSyncExternalStore(store.subscribe, store.get, store.get);
    return state;
};
```

### 3. Persist store state (optional)

To persist state to `localStorage`, inject a `LocalStorageStorage` instance when creating your store. This is the only permitted way to interact with `localStorage`.

```typescript
// UserPreference/presentations/stores/themeStore.ts

const THEME_STORAGE_KEY = 'user-theme';

export type ThemeState = 'light' | 'dark' | 'system';

export const getThemeStore = (initialState: ThemeState): Store<ThemeState> => {
    if (!themeStoreInstance) {
        const logger = Container.getInstance().get(Logger);
        const storage = new LocalStorageStorage<ThemeState>(THEME_STORAGE_KEY);
        const storedValue = storage.get();
        themeStoreInstance = new Store<ThemeState>(logger, {
            initialData: storedValue ?? initialState,
            storage,
        });
    }
    return themeStoreInstance;
};
```

### 4. Update the store in response to events

Stores are often updated in response to domain events. Subscribe to an event and call the store's `set` method to update its value.

```typescript
// User/useCases/handleFeatureFlagUpdated.ts

getEventBus().on(FeatureFlagUpdatedEvent, (event) => {
    const store = getUserSettingsStore();
    const current = store.value;

    if (!current) {
        return;
    }

    const newFlags = new Map(current.featureFlags);
    newFlags.set(event.payload.flagName, event.payload.isEnabled);

    store.set({ ...current, featureFlags: newFlags });
});
```

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

import { use } from 'react';

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
