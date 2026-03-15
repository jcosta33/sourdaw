---
name: react19-compiler
description: >
    Apply when writing or reviewing React components, hooks, or views. Enforces React 19 + React Compiler patterns: no manual memoization, ref as a regular prop (no forwardRef), use() for context and promises, useEffectEvent for stable Effect callbacks, Suspense-first async UI, useTransition for non-urgent updates, and compiler-safe component design. Apply even when the user says "create a component", "add a hook", "wrap in Suspense", "memoize", "forward ref", "read context", or "transition".
---

## Setup

```tsx
// Project/presentations/views/ProjectView.tsx
import { type ReactElement, Suspense } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getProject } from '../../useCases/getProject';

const useProject = (id: number) => {
    const { data: project } = useSuspenseQuery({
        queryKey: useProject.getKey(id),
        queryFn: ({ signal }) => getProject(id, signal),
    });

    return { project };
};

useProject.getKey = (id: number) => ['project', id];

export const ProjectView = ({ id }: { id: number }): ReactElement => {
    const { project } = useProject(id);
    const isPublished = project.status === 'published';

    return <div>{isPublished ? project.name : 'Draft'}</div>;
};

export const ProjectPage = ({ id }: { id: number }): ReactElement => {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ProjectView id={id} />
        </Suspense>
    );
};
```

## Core Patterns

### Compiler-first component design

```tsx
// Track/presentations/components/TrackHeader.tsx
import { type ReactElement } from 'react';

type TrackHeaderProps = {
    name: string;
    isActive: boolean;
    onSelect: () => void;
};

export const TrackHeader = ({ name, isActive, onSelect }: TrackHeaderProps): ReactElement => {
    const label = isActive ? `${name} (active)` : name;

    return (
        <button type="button" onClick={onSelect}>
            {label}
        </button>
    );
};
```

The React Compiler automatically memoizes components, values, and callbacks at build time. Write plain code without `useMemo`, `useCallback`, or `React.memo`.

### Ref as a regular prop (React 19)

```tsx
// Common/presentations/components/FocusableInput.tsx
import { type ReactElement, type Ref } from 'react';

type FocusableInputProps = {
    label: string;
    ref?: Ref<HTMLInputElement>;
};

export const FocusableInput = ({ label, ref }: FocusableInputProps): ReactElement => {
    return <input ref={ref} aria-label={label} />;
};
```

In React 19, `ref` is a regular prop. Destructure it directly instead of wrapping with `forwardRef`.

### Reading context with use()

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
            <button type="button" onClick={panel.toggle}>
                {panel.isCollapsed ? 'Expand' : 'Collapse'}
            </button>
        </header>
    );
};
```

The `use()` hook replaces `useContext`. It can be called conditionally and also reads Promises for Suspense-based patterns.

### Suspense with error boundaries

```tsx
// Mixer/presentations/views/MixerPage.tsx
import { type ReactElement, Suspense } from 'react';
import { ErrorBoundary } from '#/helpers/ErrorBoundary/ErrorBoundary';

export const MixerPage = (): ReactElement => {
    return (
        <ErrorBoundary fallback={<div>Something went wrong</div>}>
            <Suspense fallback={<div>Loading mixer...</div>}>
                <MixerView />
            </Suspense>
        </ErrorBoundary>
    );
};
```

Pair Suspense boundaries with error boundaries. Suspense handles the pending state; the error boundary catches rejected promises and render errors.

### useTransition for non-urgent updates

```tsx
// Library/presentations/hooks/useLibraryFilter.ts
import { useState, useTransition } from 'react';

export const useLibraryFilter = () => {
    const [filter, setFilter] = useState('');
    const [isPending, startTransition] = useTransition();

    const updateFilter = (nextFilter: string) => {
        startTransition(() => {
            setFilter(nextFilter);
        });
    };

    return { filter, isPending, updateFilter };
};
```

Wrap state updates that trigger expensive re-renders in `startTransition` to keep the UI responsive. The `isPending` flag can drive loading indicators.

### useEffectEvent for stable Effect callbacks

```tsx
// Notification/presentations/hooks/useNotificationSubscription.ts
import { useEffect, useEffectEvent } from 'react';

export const useNotificationSubscription = (onNotification: (msg: string) => void) => {
    const handleNotification = useEffectEvent(onNotification);

    useEffect(() => {
        const ws = new WebSocket('/notifications');
        ws.onmessage = (event) => {
            handleNotification(event.data);
        };

        return () => {
            ws.close();
        };
    }, []);
};
```

`useEffectEvent` (stable in React 19.2) captures the latest callback without adding it to the dependency array, preventing unnecessary Effect teardown/setup cycles.

## Common Mistakes

### CRITICAL Manual memoization

Wrong:

```tsx
// Track/presentations/components/TrackCard.tsx
import { type ReactElement, useMemo, useCallback, memo } from 'react';

export const TrackCard = memo(({ track }: TrackCardProps): ReactElement => {
    const duration = useMemo(() => formatDuration(track.durationMs), [track.durationMs]);
    const handleSelect = useCallback(() => onSelect(track.id), [track.id]);

    return <button onClick={handleSelect}>{duration}</button>;
});
```

Correct:

```tsx
// Track/presentations/components/TrackCard.tsx
import { type ReactElement } from 'react';

export const TrackCard = ({ track, onSelect }: TrackCardProps): ReactElement => {
    const duration = formatDuration(track.durationMs);
    const handleSelect = () => onSelect(track.id);

    return <button type="button" onClick={handleSelect}>{duration}</button>;
};
```

The React Compiler handles memoization automatically at build time. `useMemo`, `useCallback`, and `React.memo` are unnecessary and should be removed when touching a file.

Source: <root>/docs/conventions.md

### CRITICAL Using forwardRef

Wrong:

```tsx
// Common/presentations/components/Input.tsx
import { type ReactElement, forwardRef } from 'react';

export const Input = forwardRef<HTMLInputElement, { label: string }>(({ label }, ref) => {
    return <input ref={ref} aria-label={label} />;
});
```

Correct:

```tsx
// Common/presentations/components/Input.tsx
import { type ReactElement, type Ref } from 'react';

export const Input = ({ label, ref }: { label: string; ref?: Ref<HTMLInputElement> }): ReactElement => {
    return <input ref={ref} aria-label={label} />;
};
```

`forwardRef` is deprecated in React 19. Pass `ref` as a regular prop.

Source: <root>/docs/conventions.md

### HIGH Using useContext instead of use()

Wrong:

```tsx
// Panel/presentations/components/PanelBody.tsx
import { useContext } from 'react';
import { PanelContext } from '../context/PanelContext';

export const PanelBody = () => {
    const panel = useContext(PanelContext);
    return <div>{panel?.isCollapsed ? null : <Content />}</div>;
};
```

Correct:

```tsx
// Panel/presentations/components/PanelBody.tsx
import { use } from 'react';
import { PanelContext } from '../context/PanelContext';

export const PanelBody = () => {
    const panel = use(PanelContext);
    return <div>{panel?.isCollapsed ? null : <Content />}</div>;
};
```

Prefer `use()` over `useContext` for new code. `use()` can be called conditionally and also reads Promises.

Source: <root>/docs/conventions.md

### HIGH Using useEffect for derived state

Wrong:

```tsx
// Track/presentations/components/TrackBadge.tsx
import { type ReactElement, useState, useEffect } from 'react';

export const TrackBadge = ({ count }: { count: number }): ReactElement => {
    const [label, setLabel] = useState('');

    useEffect(() => {
        setLabel(count > 99 ? '99+' : String(count));
    }, [count]);

    return <span>{label}</span>;
};
```

Correct:

```tsx
// Track/presentations/components/TrackBadge.tsx
import { type ReactElement } from 'react';

export const TrackBadge = ({ count }: { count: number }): ReactElement => {
    const label = count > 99 ? '99+' : String(count);
    return <span>{label}</span>;
};
```

Derived values must be computed during render. Using `useEffect` causes unnecessary double-renders and out-of-sync UI.

Source: <root>/docs/conventions.md

### HIGH Missing Suspense or error boundary around async components

Wrong:

```tsx
// Mixer/presentations/views/MixerPage.tsx
import { type ReactElement } from 'react';

export const MixerPage = (): ReactElement => {
    return <MixerView />;
};
```

Correct:

```tsx
// Mixer/presentations/views/MixerPage.tsx
import { type ReactElement, Suspense } from 'react';
import { ErrorBoundary } from '#/helpers/ErrorBoundary/ErrorBoundary';

export const MixerPage = (): ReactElement => {
    return (
        <ErrorBoundary fallback={<div>Something went wrong</div>}>
            <Suspense fallback={<div>Loading mixer...</div>}>
                <MixerView />
            </Suspense>
        </ErrorBoundary>
    );
};
```

Components that suspend (via `useSuspenseQuery` or `use(promise)`) must be wrapped in a Suspense boundary. Pair with an error boundary to handle rejected promises.

Source: <root>/docs/state-management.md
