---
name: state-management
description: >
    Use when working with any form of state: fetching or caching server data, managing global or local UI state, persisting data or deriving values from props/store. Covers TanStack Query conventions, the vanilla `Store` / `ReadonlyStore` and derived state computed at render time. Apply even when the user only says "fetch data", "global state", "cache", "local storage" or "React state" and always when they reach for `useEffect` to fetch or sync state.
---

## Setup

```tsx
// Brand/presentations/hooks/useBrandDetailsSuspense.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getBrandByIdApi } from '../repositories/getBrandByIdApi';

export const useBrandDetailsSuspense = (id: number) => {
    const { data: brand } = useSuspenseQuery({
        queryKey: useBrandDetailsSuspense.getKey(id),
        queryFn: ({ signal }) => getBrandByIdApi(id, signal),
    });

    return { brand };
};

useBrandDetailsSuspense.getKey = (id: number) => ['brand', id];

// Brand/presentations/views/BrandDetailsSuspense.tsx
import { type ReactElement } from 'react';

export const BrandDetailsSuspense = ({ id }: { id: number }): ReactElement => {
    const { brand } = useBrandDetailsSuspense(id);

    // Derived state is computed directly during render
    const isPublished = brand.status === 'published';

    return <div>{isPublished ? brand.name : 'Draft'}</div>;
};
```

## Core Patterns

### Server State (TanStack Query)

```tsx
// Library/presentations/hooks/useLibraries.ts
import { useQuery } from '@tanstack/react-query';
import { getLibraries } from '../useCases/getLibraries';

type UseLibrariesParams = {
    type: string;
    filters: string;
};

export const useLibraries = ({ type, filters }: UseLibrariesParams) => {
    const { data: libraries, isLoading } = useQuery({
        queryKey: useLibraries.getKey({ type, filters }),
        queryFn: () => getLibraries({ type, filters }),
        staleTime: 300000,
    });

    return { libraries, isLoading };
};

useLibraries.getKey = ({ type, filters }: UseLibrariesParams) => ['libraries', type, filters];
```

TanStack Query must be the single source of truth for all data fetched from an API.

### Global UI State (Vanilla Store via DI)

```typescript
// App/presentations/stores/appStore.ts
import { Container } from '#/helpers/DependencyInjector/Container';
import { Store } from '#/helpers/Store/Store';
import { Logger } from '#/helpers/Logger/Logger';

type AppState = { isSidebarOpen: boolean };

let instance: Store<AppState>;

export const getAppStore = (): Store<AppState> => {
    if (!instance) {
        const logger = Container.getInstance().get(Logger);
        instance = new Store<AppState>(logger, {
            initialData: {
                isSidebarOpen: false,
            },
        });
    }
    return instance;
};
```

Use the singleton `Store` injected via the DI container for client-side UI state that isn't server data.

### Connecting a store to React

Use `useSyncExternalStore` to subscribe components to a vanilla store:

```tsx
// App/presentations/hooks/useAppStore.ts
import { useSyncExternalStore } from 'react';
import { getAppStore } from '../stores/appStore';

export const useAppStore = () => {
    const store = getAppStore();
    return useSyncExternalStore(store.subscribe, store.get, store.get);
};
```

Components receive state via props from the subscribing hook — they never import the store directly.

### Read-only stores

For state fetched from an external source and never mutated on the client (e.g. user permissions, feature flags), use `ReadonlyStore`. It is created via an async `ReadonlyStore.create()` and has no `set()` method:

```typescript
// Authorization/stores/permissionsStore.ts
import { ReadonlyStore } from '#/helpers/Store/ReadonlyStore';

export const getPermissionsStore = async (): Promise<ReadonlyStore<Permissions>> => {
    return ReadonlyStore.create({
        getDataFn: () => fetchPermissionsApi(),
    });
};
```

### Derived State

```tsx
// Common/presentations/components/Badge.tsx
import { type ReactElement } from 'react';

export const Badge = ({ count }: { count: number }): ReactElement => {
    const label = count > 99 ? '99+' : String(count);
    return <span>{label}</span>;
};
```

Compute derived state directly during rendering. The React Compiler handles memoization automatically -- do not use `useMemo`, `useCallback`, or `React.memo` manually.

## Common Mistakes

### HIGH Leaking TanStack Query internals from hooks

Wrong:

```tsx
// Brand/presentations/hooks/useBrand.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getBrandById } from '../useCases/getBrandById';

export const useBrand = (id: number) => {
    return useSuspenseQuery({
        queryKey: useBrand.getKey(id),
        queryFn: ({ signal }) => getBrandById(id, signal),
    });
};

useBrand.getKey = (id: number) => ['brand', id];
```

Correct:

```tsx
// Brand/presentations/hooks/useBrand.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getBrandById } from '../useCases/getBrandById';

export const useBrand = (id: number) => {
    const { data: brand } = useSuspenseQuery({
        queryKey: useBrand.getKey(id),
        queryFn: ({ signal }) => getBrandById(id, signal),
    });

    return { brand };
};

useBrand.getKey = (id: number) => ['brand', id];
```

Directly returning the query object leaks TanStack Query internals (`isFetching`, `error`, `status`, etc.) into components, coupling them to the library. Destructure only the properties you need and rename `data` to a meaningful domain name.

Source: <root>/docs/data-fetching.md

### CRITICAL Using useEffect for data fetching

Wrong:

```tsx
// Brand/presentations/views/BrandDetails.tsx
import { type ReactElement, useState, useEffect } from 'react';
import { Spinner } from '@frontify/fondue/components';

export const BrandDetails = ({ id }: { id: number }): ReactElement => {
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        let isMounted = true;
        fetch(`/api/brands/${id}`)
            .then((r) => r.json())
            .then((json) => {
                if (isMounted) setData(json);
            });
        return () => {
            isMounted = false;
        };
    }, [id]);

    if (!data) return <Spinner />;
    return <div>{data.name}</div>;
};
```

Correct:

```tsx
// Brand/presentations/hooks/useBrandDetailsSuspense.ts
import { useSuspenseQuery } from '@tanstack/react-query';
import { getBrandByIdApi } from '../repositories/getBrandByIdApi';

export const useBrandDetailsSuspense = (id: number) => {
    const { data: brand } = useSuspenseQuery({
        queryKey: useBrandDetailsSuspense.getKey(id),
        queryFn: ({ signal }) => getBrandByIdApi(id, signal),
    });

    return { brand };
};

useBrandDetailsSuspense.getKey = (id: number) => ['brand', id];

// Brand/presentations/views/BrandDetails.tsx
import { type ReactElement } from 'react';

export const BrandDetails = ({ id }: { id: number }): ReactElement => {
    const { brand } = useBrandDetailsSuspense(id);
    return <div>{brand.name}</div>;
};
```

Data fetching must be handled by TanStack Query; using `useEffect` circumvents the cache and creates race conditions.

Source: <root>/docs/conventions.md

### HIGH Using useEffect for derived state from props

Wrong:

```tsx
// HowMany/presentations/components/Badge.tsx
import { type ReactElement, useState, useEffect } from 'react';

export const Badge = ({ count }: { count: number }): ReactElement => {
    const [isMany, setIsMany] = useState(false);

    useEffect(() => {
        setIsMany(count > 99);
    }, [count]);

    return <span>{isMany ? '99+' : String(count)}</span>;
};
```

Correct:

```tsx
// HowMany/presentations/components/Badge.tsx
import { type ReactElement } from 'react';

export const Badge = ({ count }: { count: number }): ReactElement => {
    const label = count > 99 ? '99+' : String(count);
    return <span>{label}</span>;
};
```

Using `useEffect` to derive state causes an unnecessary double-render and leads to out-of-sync UI states.

Source: <root>/docs/conventions.md

### HIGH Manual useMemo/useCallback/React.memo

Wrong:

```tsx
// Product/presentations/components/ProductCard.tsx
import { type ReactElement, useMemo, useCallback } from 'react';

export const ProductCard = ({ product }: ProductCardProps): ReactElement => {
    const price = useMemo(() => formatPrice(product.price), [product.price]);
    const handleClick = useCallback(() => selectProduct(product.id), [product.id]);

    return <button onClick={handleClick}>{price}</button>;
};
```

Correct:

```tsx
// Product/presentations/components/ProductCard.tsx
import { type ReactElement } from 'react';

export const ProductCard = ({ product }: ProductCardProps): ReactElement => {
    const price = formatPrice(product.price);
    const handleClick = () => selectProduct(product.id);

    return <button onClick={handleClick}>{price}</button>;
};
```

The React Compiler handles memoization automatically at build time. Manual `useMemo`, `useCallback`, and `React.memo` are unnecessary and should be removed when touching a file.

Source: <root>/docs/conventions.md

### HIGH Using localStorage directly

Wrong:

```typescript
// User/useCases/saveUserPreference.ts
export const saveUserPreference = (theme: string): void => {
    window.localStorage.setItem('theme', theme);
};
```

Correct:

```typescript
// User/useCases/saveUserPreference.ts
import { getAppStore } from './appStore';

export const saveUserPreference = (theme: string): void => {
    const store = getAppStore();
    // Assuming the store is configured with LocalStorageStorage
    store.update({ theme });
};
```

Directly using `localStorage` is prohibited by custom linting rules (`no-restricted-syntax`); state must be persisted via the `Store` with `LocalStorageStorage`.

Source: <root>/docs/conventions.md
