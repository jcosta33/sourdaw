# Conventions

This guide defines coding conventions and patterns for clarity, consistency, and maintainability.

> **See also:** [Modern JS & Rust primitives](./modern-primitives.md) — current-edition language primitives (ES2024–2026 / Rust 2024) to prefer on hot, RT-audio, and interop paths.

## TypeScript soundness

- Use real types. Do not escape through `any`, unsafe casts, or broad index signatures.
- Narrow unknown values at their boundary.
- Do not suppress errors with `@ts-ignore`, `@ts-expect-error`, or disabled lint rules.
- Fix fixtures and tests to match production contracts. Never weaken the contract to make a check pass.

## Prefer explicit control flow

All control flow must be explicit. Use guard clauses for early returns and always use block statements (`{...}`) for conditionals. Avoid clever shortcuts like short-circuit invocations (`&&`) or collapsed `if` statements. This practice improves readability and reduces the chance of logical errors.

- **Related Lint Rule**: [`curly`](https://eslint.org/docs/latest/rules/curly)

```typescript
// ✅ Good: Guard clauses and block conditionals
export const renderTrack = (track: Track): void => {
    if (!track) {
        throw new Error('Missing track');
    }

    if (track.isMuted) {
        return;
    }

    if (track.isBypassed) {
        return;
    }

    renderTrackAudio(track.id);
};

// ❌ Bad: Short-circuit invocation and collapsed ifs
export const renderTrack = (track: Track): void => {
    if (!track) throw new Error('Missing track');
    track && !track.isMuted && !track.isBypassed && renderTrackAudio(track.id);
};
```

### Avoid clever JavaScriptisms

```typescript
// ❌ Bad: Chained ternaries obscure intent
const roleLabel = !user ? '—' : user.isAdmin ? 'Admin' : user.isEditor ? 'Editor' : 'User';

// ✅ Good: Clear branches with early returns/blocks
let roleLabel = '—';
if (user) {
    if (user.isAdmin) {
        roleLabel = 'Admin';
    } else if (user.isEditor) {
        roleLabel = 'Editor';
    } else {
        roleLabel = 'User';
    }
}
```

### Keep logic framework-agnostic

```tsx
// ✅ Good: Pure function + thin view wrapper
export const computeStereoPan = ({ panLeft, panRight }: PanAmount): number => {
    return Math.max(-1, Math.min(1, panRight - panLeft));
};

export const PanKnob = ({ panLeft, panRight }: PanAmount): ReactElement => {
    const value = computeStereoPan({ panLeft, panRight });
    return <span>Pan: {value}</span>;
};

// ❌ Bad: Embedding domain logic in the component
export const PanKnob = ({ panLeft, panRight }: PanAmount): ReactElement => {
    const value = Math.max(-1, Math.min(1, panRight - panLeft));
    return <span>Pan: {value}</span>;
};
```

### React anti-patterns

- **No `useEffect` for data fetching**: This is a critical pattern. Data fetching must be handled by TanStack Query (installed and wired via `src/app/queryClient.ts`; no call sites yet — until adoption, fetched server state simply has no query layer).
- **No `useEffect` for derived state**: Compute derived state directly during rendering.
- **No manual memoization**: The [React Compiler](https://react.dev/learn/react-compiler) handles memoization automatically at build time. Do not use `useMemo`, `useCallback`, or `React.memo` manually -- the compiler inserts optimal memoization for you. Existing manual calls are harmless (the compiler skips already-memoized code) but should be removed when touching a file.
- **No `forwardRef`**: In React 19, `ref` is a regular prop. Destructure it directly instead of wrapping with `forwardRef`.
- **Prefer `use()` over `useContext`**: The `use()` hook replaces `useContext` for reading context. It can be called conditionally and also reads Promises for Suspense-based patterns.
- **No manual form state**: A React Hook Form + Zod stack is the documented target ([forms](./02-forms.md)) but is **not installed yet**; until it lands, forms use local component state (`useState`).

```tsx
// ❌ Bad: Manual memoization (the React Compiler handles this automatically)
export const Parent = () => {
    const onClose = useCallback(() => modal.close(), []);
    const config = useMemo(() => ({ theme: 'dark' }), []);
    return <Dialog onClose={onClose} config={config} />;
};

// ✅ Good: Write plain code; the compiler memoizes what's needed
export const Parent = () => {
    const onClose = () => modal.close();
    const config = { theme: 'dark' };
    return <Dialog onClose={onClose} config={config} />;
};

// ❌ Bad: useEffect for derived state from props
export const Badge = ({ count }: { count: number }) => {
    const [isMany, setIsMany] = useState(false);
    useEffect(() => {
        setIsMany(count > 99);
    }, [count]);
    return <span>{isMany ? '99+' : String(count)}</span>;
};

// ✅ Good: derive during render
export const Badge = ({ count }: { count: number }) => {
    const label = count > 99 ? '99+' : String(count);
    return <span>{label}</span>;
};

// ❌ Bad: useEffect for data fetching
export const ProjectDetails = ({ id }: { id: string }) => {
    const [data, setData] = useState<Project | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);
        fetch(`/api/projects/${id}`)
            .then((r) => r.json())
            .then((json: Project) => {
                if (isMounted) {
                    setData(json);
                    setIsLoading(false);
                }
            });
        return () => {
            isMounted = false;
        };
    }, [id]);

    if (isLoading) {
        return <Spinner />;
    }
    return <div>{data?.name}</div>;
};

// ✅ Good: TanStack Query for data fetching (non-suspense)
// Project/presentations/hooks/useProjectDetails.ts

import { useQuery } from '@tanstack/react-query';

export const useProjectDetails = (id: string) => {
    const { data: project, isLoading } = useQuery({
        queryKey: ['project', id],
        queryFn: () => api.projects.getById(id),
    });

    return { project, isLoading };
};

useProjectDetails.getKey = (id: string) => ['project', id];

export const ProjectDetails = ({ id }: { id: string }) => {
    const { project, isLoading } = useProjectDetails(id);

    if (isLoading) {
        return <Spinner />;
    }
    return <div>{project?.name}</div>;
};

// ✅ Good: Suspense-enabled TanStack Query
// Project/presentations/hooks/useProjectDetailsSuspense.ts

import { useSuspenseQuery } from '@tanstack/react-query';

export const useProjectDetailsSuspense = (id: string) => {
    const { data: project } = useSuspenseQuery({
        queryKey: ['project', id],
        queryFn: () => api.projects.getById(id),
    });
    return { project };
};

useProjectDetailsSuspense.getKey = (id: string) => ['project', id];

export const ProjectDetailsSuspense = ({ id }: { id: string }) => {
    const { project } = useProjectDetailsSuspense(id);
    return <div>{project.name}</div>;
};

// ❌ Bad: Managing forms with custom state
export const EmailForm = () => {
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
            setError('Invalid email');
            return;
        }
        submit({ email });
    };

    return (
        <form onSubmit={handleSubmit}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
            {error ? <span>{error}</span> : null}
            <button type="submit">Save</button>
        </form>
    );
};
```

## Naming conventions

### File names

```text
✅ Good
components/TrackCard.tsx        # PascalCase for components
views/TrackListView.tsx         # PascalCase for views
helpers/formatTime.ts           # camelCase for utilities
models/Track.ts                 # PascalCase for models
useCases/addTrack.ts            # camelCase for use cases

❌ Bad
components/track-card.tsx       # kebab-case
components/trackcard.tsx        # lowercase
helpers/format_time.ts          # snake_case
```

### Variable and function names

```typescript
// ✅ Good: Descriptive, verbose names
const currentUserPermissions = getUserPermissions();
const isTrackMuted = track.status === 'muted';
const calculateFadeOutDuration = (baseDuration: number) => baseDuration * 1.2;

// ❌ Bad: Abbreviated, unclear names
const usrPerms = getUserPermissions();
const isMut = track.status === 'muted';
const calcFade = (d: number) => d * 1.2;
```

### Component and class names

- Components and classes must be `PascalCase`.

```typescript
// ✅ Good: PascalCase for components and classes
export const TrackCard = (): ReactElement => {
    /* */
};
export class TrackRepository {
    /* */
}
export class ProjectNotFoundError extends Error {
    /* */
}

// ❌ Bad: camelCase or other patterns
export const trackCard = (): ReactElement => {
    /* */
};
export class trackRepository {
    /* */
}
```

---

## React patterns

### Component typing

```typescript
// ✅ Good: Type the return value
import { type ReactElement } from 'react';

export const TrackCard = ({ name, color }: TrackCardProps): ReactElement => {
    return <div style={{ backgroundColor: color }}>{name}</div>;
};

// ❌ Bad: Type the component itself
import { type FC } from 'react';

export const TrackCard: FC<TrackCardProps> = ({ name, color }) => {
    return <div style={{ backgroundColor: color }}>{name}</div>;
};
```

### Ref handling (React 19)

In React 19, `ref` is a regular prop. Do not use `forwardRef`.

```tsx
// ✅ Good: ref as a regular prop (React 19)
type InputProps = {
    label: string;
    ref?: React.Ref<HTMLInputElement>;
};

export const Input = ({ label, ref }: InputProps): ReactElement => {
    return <input ref={ref} aria-label={label} />;
};

// ❌ Bad: forwardRef wrapper (deprecated in React 19)
export const Input = forwardRef<HTMLInputElement, { label: string }>(({ label }, ref) => {
    return <input ref={ref} aria-label={label} />;
});
```

### Import patterns

```typescript
// ✅ Good: Import specific types / methods
import { type ReactElement, type MouseEvent, useState, use } from 'react';

// ❌ Bad: Import React and use dot notation
import React from 'react';

export const TrackCard = (): React.ReactElement => {
    const [volume, setVolume] = React.useState(0);
    return <div>{volume}</div>;
};
```

### Type-only imports and import order

- Use type-only imports (`import { type MyType }`) for all type imports. This is enforced by the linter.
    - **Related Lint Rule**: [`@typescript-eslint/consistent-type-imports`](https://typescript-eslint.io/rules/consistent-type-imports)
- Organize imports in the following order, with newlines between groups and alphabetical sorting within groups:
    1.  Built-in (e.g., `node:fs`, `node:path`, ...)
    2.  External (e.g., `react`, `@tanstack/react-query`)
    3.  Internal (`#/modules/...` or `#/helpers/...`)
    4.  Parent (`../`)
    5.  Sibling (`./`)
    6.  Index
    7.  Object
    - **Related Lint Rule**: [`import/order`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md)

```typescript
// ✅ Good — cross-module: target a contract-folder barrel
import { useState, type ReactElement } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getTrack } from '#/modules/Arrangement/useCases';

// ✅ Good — same module: direct useCases path is fine
// import { getTrack } from './useCases/getTrack';

// ❌ Bad: Mixed order and missing type-only imports
import { ReactElement } from 'react';
import { getTrack } from '../../../../../modules/Arrangement/useCases/getTrack';
import { useSuspenseQuery } from '@tanstack/react-query';
```

### Export patterns

```typescript
// ✅ Good: Named exports
export const TrackCard = (): ReactElement => {
    /* */
};
export const useTrack = (id: string) => {
    /* */
};
export const formatTime = (seconds: number) => {
    /* */
};

// ❌ Bad: Default exports
const TrackCard = (): ReactElement => {
    /* */
};
export default TrackCard;

// ⚠️ Re-exports: Cross-module imports target a contract-folder barrel
// (useCases/stores/events/presentations/views), not a root `index.ts` — there is none.
// Within the same module, prefer direct (relative) file paths — do not add extra `index.ts` barrels.
```

### Import paths

- Use absolute imports with the `#/` alias for cross-module paths.
- Cross-module module imports must target a **contract barrel** only:
  `#/modules/<M>/useCases|stores|events|presentations/views` — never a deep file under that folder, and never a module-root `#/modules/<M>`.
- Prefer `#/utils/...` or `#/infra/...` for shared non-module code (not emptied `#/helpers/...` unless a real helper lives there).

---

## Control flow patterns

### If statements

- Always use block statements (`{...}`) for all conditionals, even single-line ones.
    - **Related Lint Rule**: [`curly`](https://eslint.org/docs/latest/rules/curly)

```typescript
// ✅ Good: Block statements always
export const validateTrackSettings = (track: Track): void => {
    if (!track.name) {
        throw new Error('Track name is required');
    }

    if (track.volume > 1) {
        throw new Error('Track volume cannot exceed 1.0');
    }
};

// ❌ Bad: Collapsed if statements
export const validateTrackSettings = (track: Track): void => {
    if (!track.name) throw new Error('Track name is required');
    if (track.volume > 1) throw new Error('Track volume cannot exceed 1.0');
};
```

### Early returns over complex ternaries

```typescript
// ✅ Good: Early return pattern
export const TrackCard = ({ track }: TrackCardProps): ReactElement => {
    if (!track) {
        return <div>Loading...</div>;
    }

    if (track.isDeleted) {
        return <div>Track no longer available</div>;
    }

    if (!track.isLoaded) {
        return <div>Track is not loaded</div>;
    }

    return (
        <div>
            <h3>{track.name}</h3>
            <p>Volume: {track.volume}</p>
        </div>
    );
};

// ❌ Bad: Complex nested ternaries
export const TrackCard = ({ track }: TrackCardProps): ReactElement => {
    return (
        <div>
            {!track ? (
                <div>Loading...</div>
            ) : track.isDeleted ? (
                <div>Track no longer available</div>
            ) : !track.isLoaded ? (
                <div>Track is not loaded</div>
            ) : (
                <div>
                    <h3>{track.name}</h3>
                    <p>Volume: {track.volume}</p>
                </div>
            )}
        </div>
    );
};
```

### JSX conditional rendering

- Use early returns, full ternary operators (`condition ? <A /> : <B />`), or logical nullish operators for conditional rendering.
- Prefer not to use the logical AND operator (`&&`) for conditional rendering, as it can lead to unexpected output (like rendering `0` or an empty string). Leaky non-boolean `&&` is **error** lint; boolean `&&` is allowed, but ternaries are the house style.
    - **Related Lint Rule**: [`@eslint-react/no-leaked-conditional-rendering`](https://eslint-react.xyz/docs/rules/no-leaked-conditional-rendering)

```typescript
// ✅ Good: Early returns and full ternaries
export const TrackActions = ({ track, canEdit }: TrackActionsProps): ReactElement => {
    if (!canEdit) {
        return <div>View only</div>;
    }

    return (
        <div>
            <button>Edit</button>
            {track.isMuted ? <button>Unmute</button> : <button>Mute</button>}
            {track.hasPlugins ? <span>Has plugins</span> : null}
            {track.clips.length > 0 ? <TrackClips clips={track.clips} /> : undefined}
        </div>
    );
};

// ❌ Bad: Logical AND operators for conditional rendering
export const TrackActions = ({ track, canEdit }: TrackActionsProps): ReactElement => {
    return (
        <div>
            {canEdit && <button>Edit</button>}
            {track.hasPlugins && <span>Has plugins</span>}
            {track.clips.length > 0 && <TrackClips clips={track.clips} />}
        </div>
    );
};

// ❌ Bad: Complex inline ternaries
export const TrackActions = ({ track, canEdit }: TrackActionsProps): ReactElement => {
    return (
        <div>
            {canEdit ? (
                <div>
                    <button>Edit</button>
                    {track.isMuted ? (
                        <button>Unmute</button>
                    ) : (
                        <button>Mute</button>
                    )}
                </div>
            ) : (
                <div>View only</div>
            )}
        </div>
    );
};
```

### Event handler patterns

```typescript
// ✅ Good: Explicit conditional call
export const handleClick = (onClick?: () => void): void => {
    if (onClick) {
        onClick();
    }
};

// ❌ Bad: Short-circuit invocation
export const handleClick = (onClick?: () => void): void => {
    onClick && onClick();
};
```

---

## Performance patterns

### The React Compiler handles memoization

The [React Compiler](https://react.dev/learn/react-compiler) (v1.0, stable since October 2025) automatically memoizes components, values, and callbacks at build time. You no longer need to think about `useMemo`, `useCallback`, or `React.memo` -- just write plain code and the compiler optimizes it.

```typescript
// ✅ Good: Plain code; the compiler memoizes automatically
export const PluginCard = ({ plugin, inputGain }: PluginCardProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(false);

    const effectiveGain = plugin.baseGain * inputGain;
    const formattedGain = `${effectiveGain.toFixed(2)} dB`;
    const isClipping = effectiveGain > 0;

    return (
        <div>
            <h3>{plugin.name}</h3>
            <p>{formattedGain}</p>
            {isClipping ? <span>Clipping!</span> : undefined}
            <button onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? 'Collapse' : 'Expand'}
            </button>
        </div>
    );
};

// ❌ Bad: Manual memoization is unnecessary with the React Compiler
export const PluginCard = ({ plugin, inputGain }: PluginCardProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(false);

    const effectiveGain = useMemo(() =>
        plugin.baseGain * inputGain, [plugin.baseGain, inputGain]
    );

    const toggleExpanded = useCallback(() => {
        setIsExpanded(!isExpanded);
    }, [isExpanded]);

    return (
        <div>
            <h3>{plugin.name}</h3>
            <p>{`${effectiveGain.toFixed(2)} dB`}</p>
            <button onClick={toggleExpanded}>
                {isExpanded ? 'Collapse' : 'Expand'}
            </button>
        </div>
    );
};
```

### Props identity

With the React Compiler, inline objects and arrays in JSX are automatically memoized when beneficial. Write naturally and let the compiler handle referential stability.

```tsx
// ✅ Good: The compiler handles identity automatically
<Chart config={{ data, options: { responsive: true } }} />;

// ✅ Also good: Extracting to a variable for readability is fine
const config = { data, options: { responsive: true } };
<Chart config={config} markers={DEFAULT_MARKERS} />;
```

### Language anti-patterns

```ts
// ❌ Bad: Truthy hacks and coercions
const name = user.name || 'Anonymous'; // Falls back on empty string
const count = +input; // Implicit number coercion
const enabled = !!maybeTruthy; // Double negation

// ✅ Good: Explicit semantics
const name = user.name ?? 'Anonymous'; // Nullish coalescing
const count = Number(input);
const enabled = Boolean(maybeTruthy);

// ❌ Bad: Defaulting via || in params
function greet(name) {
    name = name || 'world';
}
// ✅ Good: Default parameters
function greet(name = 'world') {}

// ❌ Bad: Short-circuit invocation and nested ternaries
onClick && onClick();
const label = a ? (b ? 'x' : c ? 'y' : 'z') : 'w';
// ✅ Good: Block conditionals and early returns
if (onClick) {
    onClick();
}
let label = 'w';
if (a) {
    label = b ? 'x' : c ? 'y' : 'z';
}
```

---

## Function patterns

### Function declarations

```typescript
// ✅ Good: Clear, descriptive function names
export const calculateTrackFadeDuration = ({ baseDuration, fadeMultiplier }): number => {
    return baseDuration * fadeMultiplier;
};

export const validateTrackCreationInput = (input: CreateTrackInput): void => {
    if (!input.name || input.name.length < 3) {
        throw new Error('Track name must be at least 3 characters');
    }

    if (input.volume < 0) {
        throw new Error('Track volume cannot be negative');
    }
};

// ❌ Bad: Abbreviated, unclear names
export const calcDuration = (d: number, m: number): number => {
    return d * m;
};

export const validate = (input: any): void => {
    if (!input.n || input.n.length < 3) throw new Error('Name too short');
    if (input.v < 0) throw new Error('Bad volume');
};
```

## Conventional programming patterns

- Prefer conventional, framework-agnostic patterns over JavaScriptisms.
- Use explicit blocks over clever one-liners; avoid short-circuit calls and terse conditionals.
- Keep logic in pure functions and use cases; React remains a thin view.

```typescript
// Strategy pattern (choose implementation at runtime)
type SortStrategy = (tracks: Track[]) => Track[];

const sortByName: SortStrategy = (tracks) => [...tracks].sort((a, b) => a.name.localeCompare(b.name));
const sortByDate: SortStrategy = (tracks) => [...tracks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

export const getSortedTracks = (tracks: Track[], strategy: 'name' | 'date'): Track[] => {
    if (strategy === 'name') {
        return sortByName(tracks);
    }
    return sortByDate(tracks);
};

// Module store singleton (preferred)
import { createStore } from '#/infra/store/createStore';
export const appStore = createStore<AppState>({ initialData: { /* ... */ } });

// Adapter pattern (transformer layer maps DTO → domain)
type ApiUser = { user_id: number; full_name: string };
type User = { id: number; name: string };
export const mapUserFromApiToModel = (api: ApiUser): User => ({ id: api.user_id, name: api.full_name });

// Observer pattern (domain events — string keys, unwrapped payload)
eventBus.on('track.added', (payload) => {
    auditUseCase.recordTrackAdded(payload);
});
```

Guidelines:

- Avoid ternaries in complex logic; prefer early returns or helper variables/functions.
- Never use short-circuit invocation `(fn && fn())`.
- Keep patterns framework-agnostic; React is only for rendering and wiring.

## Lint-aligned conventions

- **Equality and basics**: Use `===`/`!==` (no loose equality); prefer `const`; prefer template strings; no `eval`; no `debugger`.
- **Curly braces**: Required for all conditionals and loops. ([`curly`](https://eslint.org/docs/latest/rules/curly))
- **TypeScript**: Use `import { type MyType }`. ([`@typescript-eslint/consistent-type-imports`](https://typescript-eslint.io/rules/consistent-type-imports))
- **Promises**: Always handle promises (`return`/`catch`/`await`). Avoid floating promises.
- **React**: No class components; no default React import; JSX uses double quotes; no `forwardRef` (use `ref` as a prop); no manual `useMemo`/`useCallback`/`React.memo` (the React Compiler handles memoization).
- **DOM**: Prefer `textContent` over `innerText`. ([`unicorn/prefer-dom-node-text-content`](https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/prefer-dom-node-text-content.md))
- **Imports**: Enforce group order and alphabetical sort. ([`import/order`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md))
- **Storage**: Do not use `localStorage` directly; persist via `Store` with `LocalStorageStorage`. This is enforced by a custom lint rule. ([`no-restricted-syntax`](https://eslint.org/docs/latest/rules/no-restricted-syntax))

### Parameter patterns

```typescript
// ✅ Good: Descriptive parameter names
export const createMixerNotification = ({ trackName, alertLevel, notificationType }): void => {
    // Implementation
};

// ❌ Bad: Single letter or abbreviated parameters
export const createNotif = (t: string, a: string, n: string): void => {
    // Implementation
};

// ✅ Good: Single object with descriptive properties
export const updateTrackVisibility = ({ trackId, isVisible, notifyMixer, updateMetrics }): void => {
    // Implementation
};

// ❌ Bad: Multiple boolean parameters - unclear what each does
export const updateTrack = (trackId: string, isVisible: boolean, notify: boolean, updateMeta: boolean): void => {
    // Implementation
};

// ❌ Bad: Function call is unclear without checking the signature
updateTrack('track-123', true, false, true); // What do these booleans mean?

// ✅ Good: Function call is self-documenting
updateTrackVisibility({
    trackId: 'track-123',
    isVisible: true,
    notifyMixer: false,
    updateMetrics: true,
});
```

---

## Common patterns

```typescript
// ✅ Good: Following all conventions
import { type ReactElement, useState } from 'react';

type TrackCardProps = {
    track: Track;
    onTrackSelect: (trackId: string) => void;
};

export const TrackCard = ({ track, onTrackSelect }: TrackCardProps): ReactElement => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!track) {
        return <div>No track data available</div>;
    }

    if (track.isDeleted) {
        return <div>This track has been removed</div>;
    }

    const handleTrackClick = () => {
        onTrackSelect(track.id);
    };

    const formattedVolume = `${track.volume.toFixed(2)} dB`;

    return (
        <div onClick={handleTrackClick}>
            <h3>{track.name}</h3>
            <p>{formattedVolume}</p>
            {isExpanded ? (
                <div>{track.kind}</div>
            ) : undefined}
        </div>
    );
};
```
