# State management

This document explains our approach to client-side state management for UI and domain state. For server state, use TanStack Query. For cross-domain UI updates, use [domain events](./04-events.md).

---

## Our approach to state

Our state management philosophy is to keep domain state in plain, framework-agnostic TypeScript stores, decoupling it from the UI. We connect these vanilla stores to React components using the `useStore` hook from `#/infra/store/useStore`. This ensures clear boundaries, as components receive data via props from subscribing views or hooks rather than accessing stores directly. We reserve React Context for simple, localized UI state -- consumed via the `use()` hook (React 19) rather than `useContext`.

### The vanilla store

Our custom `Store` (factory at `#/infra/store/createStore`, React bind at `#/infra/store/useStore`) provides a simple but powerful foundation for creating observable state containers. It is framework-agnostic and can be used anywhere in the application.

---

## Cross-module store contracts

Business-layer stores (located at `ModuleName/stores/`, outside `presentations/`) are **cross-module read contracts**. Import only via the **`#/modules/<M>/stores` barrel** (never a deep file path). Other modules may **subscribe/read**; they must **not** call `store.set` on a foreign store — write through the owning module’s use cases or `executeAppAction`. Owning-module use cases may read/write their own store. Presentation **hooks/views** bind with `useStore`; leaf **components** should receive data via props (same-module store imports from components are machine-banned; prefer views/hooks).

Presentation-layer stores (located at `ModuleName/presentations/stores/`) are **module-private**. They hold UI preferences (zoom, sidebar state, panel layout) and are never imported by another module.

```typescript
// ✅ Cross-module: import a business-layer store from the contract barrel
import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';

const trackState = useStore(trackStore);
const tracks = trackState?.tracks ?? [];

// ❌ Forbidden: deep import into the stores folder
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

// ❌ Forbidden: import a presentation-layer store from another module
import { zoomStore } from '#/modules/Arrangement/presentations/stores/zoomStore';
```

---

## How to create and use a store

This section provides a practical guide to creating, persisting, and subscribing to a store.

### 1. Define and create the store

A store is a module-level singleton from `createStore` (`#/infra/store/createStore`).

```typescript
// Workspace/stores/workspacePreferencesStore.ts
import { createStore } from '#/infra/store/createStore';

export type WorkspacePreferences = {
    theme: 'light' | 'dark';
    defaultSampleRate: 44100 | 48000 | 96000;
    showMetrics: boolean;
};

export const workspacePreferencesStore = createStore<WorkspacePreferences>({
    initialData: {
        theme: 'dark',
        defaultSampleRate: 48000,
        showMetrics: false,
    },
});
```

### 2. Connect the store to React with a hook

Views/hooks use `useStore`. Leaf components should receive props from a view/hook.

```tsx
// Workspace/presentations/hooks/useWorkspacePreferences.ts
import { useStore } from '#/infra/store/useStore';
import { workspacePreferencesStore, type WorkspacePreferences } from '../../stores/workspacePreferencesStore';

const defaultPreferences: WorkspacePreferences = {
    theme: 'dark',
    defaultSampleRate: 48000,
    showMetrics: false,
};

export const useWorkspacePreferences = (): WorkspacePreferences => {
    return useStore(workspacePreferencesStore, defaultPreferences);
};
```

### 3. Persist store state (optional)

Pass a storage adapter into `createStore` when persistence is required (see `#/infra/store/storage/*`). Prefer project patterns already used by Workspace/Arrangement stores over ad-hoc `localStorage` access.

Persisted blobs must hydrate through a validator: pass `createStore({ sanitize })` so a stored value is re-validated on load and rewritten if it has drifted. The dangerous case is a **present-but-invalid** blob, not a missing one -- an empty store simply seeds `initialData`, but a blob whose shape no longer matches the current schema will hydrate straight into live state unless `sanitize` narrows or discards it first.

### 4. Update the store through the owning write path

Prefer owner use cases / `executeAppAction` for meaningful writes. Same-module code may update the store directly when that is the established pattern; foreign modules must not `store.set`.

Use `set` directly when you are replacing the value wholesale (e.g., loading from persistence), and `clear()` to remove it entirely.

A mutate-and-persist is **one operation**, not two: never write state through a path that silently skips the store's persistence wiring, or the in-memory value and the persisted blob diverge across a reload. Route the change through `set` / `update` on the persisted store (or the owning use case) so the mutation and its persistence stay a single step.

Prefer `store.update(updater)` over reading a snapshot and calling `.set()` when the new value derives from the current one -- especially across an `await`. A snapshot-then-`set` read-modify-write can be interleaved by another writer during the gap, clobbering their change; `update` applies the updater against the live value in one synchronous step and closes that race.

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

## Async and server state

Use TanStack Query for fetched data with loading, caching, invalidation, or refetch semantics. Sourdaw does not have a `ReadonlyStore` API; do not invent one or put server data in a vanilla store.
