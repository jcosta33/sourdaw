# Testing

TypeScript tests use **Vitest** and live under **`__tests__/`** folders (see §3). This document defines how we add and structure them — deliberately, incrementally, and with one consistent shape per layer.

---

## 1. Philosophy

- **Shallow unit tests only.** Every test exercises one function, one class, or one component in isolation. Every dependency that crosses a module boundary, touches the OS, or hits the audio thread is mocked at the import boundary.
- **Unit-first.** Playwright E2E lives under `tests/e2e/`. Run only affected specs with `pnpm test:e2e -- <spec>`. Prefer Vitest unit/component coverage; grow E2E only with a real reason.
- **Ad-hoc live-UI probes are not E2E.** One-off browser probes/screenshots live in `.agents/ui-scripts/` per the `playwright-ui-bridge` skill — never add them to `tests/e2e/`.
- **One test file per source file.** The spec lives in **`__tests__/`** inside the same folder as the source file — e.g. `useCases/addTrack.ts` → `useCases/__tests__/addTrack.spec.ts`. Do **not** place `*.spec.ts` beside production files. If a source file is hard to unit-test, that is a signal about the source file, not the tests.
- **Mock surface dependencies, not internals.** When testing a use case, mock the repositories it calls. When testing a repository, mock `#/utils/desktopBridge` or `AudioContext`. When testing a transformer, mock nothing — it is pure.
- **Real domain types in tests.** Event payloads and `AppError` values are constructed for real in tests. They are cheap, correct, and faking them hides bugs.

---

## 2. What we test, what we do not

**Test:**

- Use cases — orchestration logic in `useCases/`
- Repositories — all I/O, with their external dependency mocked
- Transformers — pure mapping functions in `transformers/`
- Services and validators — pure business logic in `services/` and `validators/`
- Stores — the custom `Store<T>` class and its backing storage
- Event subscribers — files that call `eventBus.on(...)`
- Engine classes — `TrackNode`, scheduler classes, anything in `engine/`, with `AudioContext` mocked
- Presentation hooks — thin wrappers over `useStore` and similar
- Presentation components — rendering + user interaction
- Presentation helpers — pure utility functions

**Do not test (yet):**

- Real desktop IPC round-trips
- Real Web Audio rendering (AudioWorklet output, scheduler correctness with real time)
- Real Automerge document convergence
- Cross-module flows end-to-end
- The DI Container's lazy-proxy behaviour — tests register fakes explicitly before reading
- React components rendered against real stores — mock the store
- The audio thread itself — on the TS side, audio-thread constraints (no allocation, no locks, no blocking) are enforced by code review, not by tests (`crates/daw-dsp` RT paths are test-enforced via `assert_no_alloc`)

---

## 3. File layout

Tests live in **`__tests__/`** subfolders **inside** the folder that owns the code under test (same “concept” as the implementation: `useCases`, `repositories`, a presentation `views` segment, etc.).

**Rule:** For `path/to/SourceFile.ts`, the spec is `path/to/__tests__/SourceFile.spec.ts` (same basename). Use `*.spec.tsx` for components.

**Imports:** From `useCases/__tests__/addTrack.spec.ts`, import the subject with a **sibling-relative** path — e.g. `import { addTrack } from '../addTrack';`.

**Module-wide** shared utilities (dummy factories, module-local mocks) live in **`src/modules/<Module>/__tests__/`** at the **module root** and are imported from deeper specs with relative paths (e.g. `../../__tests__/TrackDummy`).

**Cross-module** test utilities (mock `AudioContext`, shared helpers) live in **`src/helpers/__tests__/`**. DI and event **runtime test helpers** (not specs) live in **`src/infra/di/testing/`** and **`src/infra/events/testing/`**.

**Knip** includes test files in the default project graph. Its Vitest plugin
registers `*.spec.*` and `*.test.*` files as entry points automatically, so do
not exclude them from `project`. The shipped `src` patterns in `knip.json`
end with `!` for production mode; the unsuffixed `scripts` pattern remains
comprehensive-only. Dead-code audits are repository-wide and explicit-only. Run
`pnpm deps:unused` or `pnpm deps:unused:production` after installing both dependency sets from the
[README setup](../README.md).

```text
src/modules/Arrangement/
├── __tests__/
│   ├── TrackDummy.ts              # module-wide dummy factory
│   ├── ClipDummy.ts
│   └── eventBus.mock.ts           # module-local mock (if needed)
├── useCases/
│   ├── __tests__/
│   │   ├── addTrack.spec.ts
│   │   └── removeTrack.spec.ts
│   ├── addTrack.ts
│   └── removeTrack.ts
├── repositories/
│   ├── __tests__/
│   │   └── trackTemplate.spec.ts
│   └── trackTemplate.ts
├── transformers/
│   ├── __tests__/
│   │   └── automationTransformers.spec.ts
│   └── automationTransformers.ts
└── presentations/
    └── hooks/
        ├── __tests__/
        │   └── useTracks.spec.ts
        ├── useTracks.ts
        └── useMoveClip.ts
```

Nested UI folders follow the same pattern (e.g. `presentations/views/Mixer/__tests__/SendsSection.spec.tsx` next to `Mixer/SendsSection.tsx`).

---

## 4. Naming convention

Every `it` block starts with `should` or `should not`, followed by a concise description of the behaviour under test:

- `it('should add the track and emit TrackAddedEvent')`
- `it('should not emit when the store is empty')`
- `it('should throw InvalidTempoError when bpm is below 20')`

---

## 5. Dependency injection in tests

The business layer uses the `inject()` DI pattern (see `docs/architecture/03-typescript-module.md §4.11`). Tests for injectable functions **must** use the companion test helpers rather than `vi.mock()`:

- **`inject(deps)(factory)`** — `#/infra/di/inject` — curried DI wrapper. The first call takes a dependency map, the second takes a factory that receives resolved deps. The wrapped function carries internal DI metadata used by the test seam.
- **`injectDependencies(subject, mocks)`** — `#/infra/di/testing/injectDependencies` — calls `Container.clear()` and registers mocks against the subject's dependencies. Throws if a declared dependency is missing from `mocks`. Returns the subject for chaining.
- **`spy<T>()`** — `#/infra/di/testing/spy` — creates a typed lazy spy. Every accessed method is a cached `vi.fn()` typed to the original signature; configure those mocks after access. The helper takes no overrides argument.

### When to use which

| Subject under test                                              | Mock its deps with                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| An injectable (function wrapped in `inject()`)                  | `spy<T>()` + `injectDependencies()`                                       |
| A module outside the inject map (`#/utils/desktopBridge`, etc.) | `vi.mock(modulePath, ...)`                                                |
| Thin static same-module repos used by an injectable             | `vi.mock` on those repo modules is OK when they are not in the inject map |

Do not mix `vi.mock()` with `injectDependencies()` for the same dependency. Pick one.

### Mocking a contract barrel

A `vi.mock` of another module's contract barrel (`useCases`, `stores`, `events`, `presentations/views`) whose factory lists every export by hand goes stale silently. Anything added to that barrel later resolves to `undefined` in this spec. For a view that means React throws on render, so **every** test in the mocking file reds — in a module the author's diff never touched. That is not hypothetical: adding `MissingMediaPanel` to `Project/presentations/views` took out all 13 tests in `WorkspaceShell/…/TransportBar.spec.tsx`.

Two shapes are correct, and the cheap one is first:

```ts
// 1. Name every export the spec's module graph actually imports from the barrel.
//    Costs nothing at import time — the factory still replaces the whole barrel.
//    Use this when the barrel is heavy, or when the point of the mock is that the
//    real module must not load (`src/app/__tests__/App.spec.tsx` is the example).
vi.mock('#/modules/Project/presentations/views', () => ({
    RecentProjectsMenu: () => <div data-testid="recent-projects" />,
    ArrangementSelector: () => <div data-testid="arrangement-selector" />,
    MissingMediaPanel: () => <div data-testid="missing-media-panel" />,
}));

// 2. Spread the original first, then override only what you stub. Later additions
//    resolve to the real export instead of `undefined`. This loads the real module
//    and its graph, so measure before using it on a heavy barrel — on
//    `ArrangeView.spec.tsx` the spread costs +75% wall time.
vi.mock('#/modules/Project/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/presentations/views')>()),
    RecentProjectsMenu: () => <div data-testid="recent-projects" />,
}));
```

`pnpm test:barrel-mocks` enforces this for `presentations/views` barrels: it walks each spec's module graph and fails when a non-spread factory omits a name that graph imports. Its focused guard spec covers the checker. The failure names the spec, barrel, missing export, and consuming module, then prints the three remedies, including a reasoned `exemptions` row in `scripts/checkBarrelMockCoverage.ts`. `--all` reports the same class across the other three barrel kinds, which are measured rather than gated. Background: PR #1572, issue #1393.

### Canonical test shape for an injectable

```typescript
// Real pattern for Arrangement/useCases/addTrack.ts:
// inject only ArrangementEventBus; thin repos are static imports (often vi.mock'd).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { addTrack } from '../addTrack';

vi.mock('../../repositories/track/getTrackState', () => ({ getTrackState: vi.fn() }));
vi.mock('../../repositories/track/setTrackState', () => ({ setTrackState: vi.fn() }));

describe('addTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should append the track and emit track.added', async () => {
        const { getTrackState } = await import('../../repositories/track/getTrackState');
        const { setTrackState } = await import('../../repositories/track/setTrackState');
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null });

        const eventBus = { emit: vi.fn().mockResolvedValue(undefined) };
        injectDependencies(addTrack, { eventBus });

        const result = addTrack({ name: 'Drums', kind: 'audio' });

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith('track.added', expect.objectContaining({ name: 'Drums' }));
    });
});
```

Notes on this shape:

- `injectDependencies` mocks **only** the inject map keys (here `eventBus`). Static repo imports are mocked with `vi.mock` when needed.
- Prefer the real `addTrack.spec.ts` under Arrangement as the source of truth when examples drift.

---

## 6. How to test each layer

Every example below uses a real file from the codebase as its subject.

### 6.1 Use cases

Subject: `src/modules/Arrangement/useCases/addTrack.ts` — wrapped with `inject()`, reads a repo, writes the repo, emits an event.

Use the canonical shape from §5: `spy<T>()` + `injectDependencies()` for dependencies in the inject map. Do not `vi.mock()` an injected dependency; static repository imports may use the module mock shown above.

Use the canonical shape from §5 (and the real `useCases/__tests__/addTrack.spec.ts` in Arrangement). Do not invent `TrackRepo` / `Logger` inject deps that the subject does not declare.

### 6.2 Repositories — desktop IPC

Subject: `src/modules/CrdtDocument/repositories/nativeCrdtPersistence/nativeCreateProject.ts` — wraps the module's `invokeCommand` adapter.

Mock `invokeCommand` at the repository-folder boundary. Its own repository test covers the `desktopInvoke` call.

```typescript
// src/modules/CrdtDocument/repositories/nativeCrdtPersistence/__tests__/nativeCrdtPersistence.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invokeCommand } from '../invokeCommand';
import { nativeCreateProject } from '../nativeCreateProject';

vi.mock('../invokeCommand', () => ({
    invokeCommand: vi.fn(),
}));

describe('nativeCreateProject', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should invoke collab_create_project with the given name and sample rate', async () => {
        vi.mocked(invokeCommand).mockResolvedValue(true);

        const result = await nativeCreateProject('My Project', 48000);

        expect(invokeCommand).toHaveBeenCalledWith('collab_create_project', {
            name: 'My Project',
            sampleRate: 48000,
        });
        expect(result).toBe(true);
    });

    it('should return false when the native layer returns null', async () => {
        vi.mocked(invokeCommand).mockResolvedValue(null);

        const result = await nativeCreateProject('My Project', 48000);

        expect(result).toBe(false);
    });
});
```

If the repository checks `isDesktopRuntime()` and short-circuits outside the desktop shell, also mock that helper (`#/utils/desktopRuntime`) and test both branches.

### 6.3 Repositories — Web Audio

Web Audio code is built on `AudioContext` and its node types. We provide a mock `AudioContext` factory (see §7.4) and assert on node wiring and parameter calls.

```typescript
// src/modules/AudioEngine/repositories/__tests__/createWebAudioEngine.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { createWebAudioEngine } from '../createWebAudioEngine';

describe('createWebAudioEngine', () => {
    it('should connect the master gain node through the analyser to the destination', () => {
        const ctx = createMockAudioContext();
        // inject the mock context via whatever seam the repository exposes
        const engine = createWebAudioEngine({ context: ctx });

        expect(engine.masterGainNode.connect).toHaveBeenCalledWith(engine.masterAnalyser);
        expect(engine.masterAnalyser.connect).toHaveBeenCalledWith(ctx.destination);
    });
});
```

### 6.4 Repositories — storage-backed

For repositories that read/write through a `Store<T>`, swap the backing storage for `MemoryStorage` in the test. Do not mock `Store` itself — the class is small and well-tested in isolation (§6.7).

```typescript
// src/modules/Arrangement/repositories/__tests__/trackTemplate.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadTrackTemplates, saveTrackTemplates } from '../trackTemplate';

describe('trackTemplate repository', () => {
    beforeEach(() => {
        // the repository uses LocalStorageStorage under the hood — for a true unit
        // test, inject a MemoryStorage via module refactor, or mock LocalStorageStorage
        localStorage.clear();
    });

    it('should return an empty array when nothing is saved', () => {
        expect(loadTrackTemplates()).toEqual([]);
    });

    it('should persist and retrieve templates', () => {
        const templates = [{ id: 't1', name: 'Drums' }];
        saveTrackTemplates(templates);
        expect(loadTrackTemplates()).toEqual(templates);
    });
});
```

If the repository is not designed to accept its storage by injection, that is a refactor to request, not a reason to write a worse test. Prefer injecting `MemoryStorage` at construction time.

### 6.5 Transformers

Subject: `src/modules/Arrangement/transformers/automationTransformers.ts` — pure math.

```typescript
// src/modules/Arrangement/transformers/__tests__/automationTransformers.spec.ts
import { describe, it, expect } from 'vitest';
import { interpolateAutomationValue, generateShapePoints } from '../automationTransformers';

describe('interpolateAutomationValue', () => {
    it('should return the endpoint value when the requested beat equals p2.beat', () => {
        const p1 = { beat: 0, value: 0 };
        const p2 = { beat: 4, value: 1 };
        expect(interpolateAutomationValue(p1, p2, 4)).toBe(1);
    });

    it('should linearly interpolate halfway between two points', () => {
        const p1 = { beat: 0, value: 0 };
        const p2 = { beat: 4, value: 1 };
        expect(interpolateAutomationValue(p1, p2, 2)).toBeCloseTo(0.5);
    });
});

describe('generateShapePoints', () => {
    it('should build a two-point ramp for sawtooth-up between min and max', () => {
        expect(generateShapePoints('sawtooth-up', 0, 4, 0, 1)).toEqual([
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 4, value: 1, curve: 'linear', tension: 0 },
        ]);
    });
});
```

No mocks. No `beforeEach`. Input in, output out.

### 6.6 Validators and services

Treat exactly like transformers — pure functions, no mocks, input/output assertions. One file per validator, one `describe` per exported function.

### 6.7 Stores (`#/infra/store`)

Subject: `createStore` / `useStore` under `src/infra/store/`.

Test the observable contract against the real factory: initial snapshot, `set`, subscribe/unsubscribe (and storage adapters if used). Prefer existing tests under `src/infra/store/` as the pattern source over inventing a parallel `Store` class path.

### 6.8 Event subscribers

Files that wire a domain handler via `eventBus.on(...)`. For a focused subscriber test, use `createEventBus()` from `#/infra/events/createEventBus` to create a real bus, wire one subscriber, then emit events and assert on its side effects. Do not cross product-module boundaries.

```typescript
// src/modules/Toaster/useCases/__tests__/toasterSubscriber.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '#/infra/events/createEventBus';
import type { AppEvents } from '#/app/registerDependencies';

describe('initToasterSubscribers', () => {
    it('should hydrate Toaster controls when audioDevice.loaded fires', async () => {
        const bus = createEventBus<AppEvents>();
        // wire up the subscriber with the test bus
        const unsubscribe = initToasterSubscribers(bus);

        await bus.emit('audioDevice.loaded', { deviceId: 'dev-1', deviceType: 'toaster' });

        // assert on the side effects (store updates, param calls, etc.)
        // ...

        unsubscribe();
    });
});
```

For unit-style tests using spies, build a spy with `on` and `emit` methods and inject it:

```typescript
import { spy } from '#/infra/di/testing/spy';

const eventBus = spy<{ on: (event: string, handler: Function) => () => void }>();
// retrieve the registered handler from spy mock calls
const handler = eventBus.on.mock.calls[0][1];
handler({ deviceId: 'dev-1', deviceType: 'toaster' });
```

### 6.9 Presentation hooks

Subject: `src/modules/Arrangement/presentations/hooks/useTracks.ts` — thin wrapper over `useStore` reading `trackStore`.

Mock the store. Use `@testing-library/react`'s `renderHook`.

```typescript
// src/modules/Arrangement/presentations/hooks/__tests__/useTracks.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTracks } from '../useTracks';
import { trackStore } from '../../../stores/trackStore';
import { TrackDummy } from '../../../__tests__/TrackDummy';

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        value: null,
        subscribe: vi.fn(() => () => {}),
    },
}));

describe('useTracks', () => {
    it('should return the default empty state when the store value is null', () => {
        vi.mocked(trackStore).value = null;

        const { result } = renderHook(() => useTracks());

        expect(result.current).toEqual({ tracks: [], selectedTrackId: null });
    });

    it('should return the stored tracks and selectedTrackId', () => {
        const track = TrackDummy.create();
        vi.mocked(trackStore).value = { tracks: [track], selectedTrackId: track.id };

        const { result } = renderHook(() => useTracks());

        expect(result.current.tracks).toEqual([track]);
        expect(result.current.selectedTrackId).toBe(track.id);
    });
});
```

### 6.10 Presentation components and views

Use `@testing-library/react` from the user's perspective.

- **Leaf components** should not import useCases or business stores — pass props/callbacks from a **view/hook**, and test that surface (or pass mocked callbacks into the component).
- **Views/hooks** may call use cases; mock those use cases (or the command bus) when testing the view.

```typescript
// Prefer testing a view that owns the use-case call, or a component that receives onAddTrack:
// src/modules/Arrangement/presentations/components/__tests__/AddTrackButton.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddTrackButton } from '../AddTrackButton';

describe('AddTrackButton', () => {
    it('should call the provided callback when clicked', () => {
        const onAddTrack = vi.fn();
        render(<AddTrackButton kind="audio" onAddTrack={onAddTrack} />);
        fireEvent.click(screen.getByRole('button', { name: /add audio track/i }));
        expect(onAddTrack).toHaveBeenCalled();
    });
});
```

### 6.11 Engine classes

Subject: `src/modules/AudioEngine/engine/TrackNode.ts` — constructs an audio graph from an `AudioContext`.

Pass a mock `AudioContext` (see §7.4) via the constructor `deps`. Assert on the node connections and parameter calls — these are the only observable outputs of the class until the audio thread runs.

```typescript
// src/modules/AudioEngine/engine/__tests__/TrackNode.spec.ts
import { describe, it, expect } from 'vitest';
import { TrackNode } from '../TrackNode';
import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';

describe('TrackNode', () => {
    it('should wire gain → preFaderTap → fader → pan → analyser in order', () => {
        const ctx = createMockAudioContext();
        const node = new TrackNode('track-1', { context: ctx });

        expect(node.strip.gainNode.connect).toHaveBeenCalledWith(node.strip.preFaderTap);
        expect(node.strip.preFaderTap.connect).toHaveBeenCalledWith(node.strip.faderNode);
        expect(node.strip.faderNode.connect).toHaveBeenCalledWith(node.strip.panNode);
        expect(node.strip.panNode.connect).toHaveBeenCalledWith(node.strip.analyserNode);
    });

    it('should clamp gain to [0, 1] when setGain is called with out-of-range input', () => {
        const ctx = createMockAudioContext();
        const node = new TrackNode('track-1', { context: ctx });

        node.setGain(1.5);
        expect(node.strip.faderNode.gain.setTargetAtTime).toHaveBeenCalledWith(1, ctx.currentTime, 0.01);

        node.setGain(-0.2);
        expect(node.strip.faderNode.gain.setTargetAtTime).toHaveBeenCalledWith(0, ctx.currentTime, 0.01);
    });
});
```

---

## 7. Patterns

### 7.1 Dummy factories

Each module owns factories for its domain models in `__tests__/`. Factories accept a partial override and return a full, plausible instance.

```typescript
// src/modules/Arrangement/__tests__/TrackDummy.ts
import type { Track } from '../models/Track';

let counter = 0;

export const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
        id: `track-${++counter}`,
        name: 'Test Track',
        kind: 'audio',
        color: '#ff0000',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        ...overrides,
    }),
};

export const TracksDummy = {
    create: ({ length }: { length: number }): Track[] =>
        Array.from({ length }, (_, i) => TrackDummy.create({ id: `track-${i + 1}` })),
};
```

Use a deterministic counter for IDs, not `Math.random`. Tests should be reproducible.

### 7.2 EventBus spying

For injectables that depend on the event bus, build a local spy per test — no shared module-level mock is needed:

```typescript
const eventBus = spy<{
    emit: (event: string, payload: unknown) => Promise<void>;
    on: (event: string, handler: Function) => () => void;
}>();
injectDependencies(subjectUnderTest, { eventBus /* other deps */ });
```

The spy gives you typed `eventBus.emit` and `eventBus.on` as `Mock`s directly. Retrieve registered handlers via `eventBus.on.mock.calls[n][1]` and invoke them to test subscriber behaviour (see §6.8).

Alternatively, use `createEventBus()` from `#/infra/events/createEventBus` for a focused EventBus contract or subscriber test, paired with `recordEvents()` from `#/infra/events/testing/recordEvents` to capture emitted events.

Subjects that need collaborators must be wrapped with `inject()` so tests can supply mocks via `injectDependencies()` (§5).

### 7.3 DI container and `injectDependencies()`

For injectables, use `injectDependencies()` (§5). It:

1. Calls `Container.clear()` to reset container-backed state used by the DI layer.
2. Validates that every key in the subject’s `inject()` dependency map has a matching mock.
3. Registers each mock in the internal `testOverrides` map keyed by the **original** dependency reference (the same object identity the injectable uses in its map).
4. Returns the subject for chaining.

Do not hand-manage `Container` in tests when testing `inject()`-wrapped functions — `injectDependencies()` is the single supported path.

If you must test code that resolves a **class token** via `Container.get()` (e.g. infra unit tests), use `Container.clear()` in `afterEach` and `Container.register()` / `Container.set()` as appropriate for that isolated test file — see `src/infra/di/__tests__/Container.spec.ts`.

### 7.4 AudioContext mock

Cross-module helper in `src/helpers/__tests__/audioContext.mock.ts`. It builds a fake `AudioContext` whose nodes expose spied `connect`/`disconnect` methods and typed `AudioParam` stubs.

```typescript
// src/helpers/__tests__/audioContext.mock.ts
import { vi } from 'vitest';

const createAudioParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
});

const createNode = (extra: Record<string, unknown> = {}) => ({
    connect: vi.fn(function (this: unknown, target: unknown) {
        return target;
    }),
    disconnect: vi.fn(),
    ...extra,
});

export function createMockAudioContext() {
    const destination = createNode();
    return {
        currentTime: 0,
        sampleRate: 48000,
        destination,
        createGain: vi.fn(() => createNode({ gain: createAudioParam() })),
        createStereoPanner: vi.fn(() => createNode({ pan: createAudioParam() })),
        createAnalyser: vi.fn(() =>
            createNode({
                frequencyBinCount: 1024,
                getByteTimeDomainData: vi.fn(),
                getFloatFrequencyData: vi.fn(),
            })
        ),
        createBufferSource: vi.fn(() =>
            createNode({
                buffer: null,
                playbackRate: createAudioParam(),
                start: vi.fn(),
                stop: vi.fn(),
            })
        ),
        createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
            numberOfChannels: channels,
            length,
            sampleRate,
            getChannelData: vi.fn(() => new Float32Array(length)),
        })),
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        resume: vi.fn().mockResolvedValue(undefined),
        suspend: vi.fn().mockResolvedValue(undefined),
    };
}
```

Extend this as new node types are needed. Keep it flat and direct — this is a test helper, not a Web Audio polyfill.

### 7.5 Storage mocks

`createStore` accepts a `storage` option. Tests that need an isolated store should pass `createMemoryStorage()` (or the project’s memory storage helper) rather than inventing a mock class.

If a module’s store is a module-level singleton (e.g. `export const trackStore = createStore(...)`), tests must either:

1. Mock the whole store module (as in §6.9), or
2. Call a reset helper exposed alongside the store that swaps its backing storage.

Prefer (1) unless the store is the subject under test.

### 7.6 Desktop runtime availability

Repositories that check `isDesktopRuntime()` before invoking a command need that check mocked:

```typescript
vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: vi.fn(() => true),
}));
```

Test both branches: the desktop path (mock `desktopInvoke`) and the browser-only fallback path.

---

## 8. Rust testing

Rust unit tests live alongside source in `#[cfg(test)]` modules, per standard Rust convention.

Real example: `crates/daw-dsp/src/grinder/engine.rs` has a `mod tests` that builds a `GrinderEngine`, pushes a generated sine wave through `process_block`, and asserts on the output envelope.

### Pattern: DSP signal-in / signal-out

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn process_sine(engine: &mut YourEngine, frequency: f32, samples: usize) -> Vec<f32> {
        let mut left = vec![0.0_f32; samples];
        let mut right = vec![0.0_f32; samples];
        for n in 0..samples {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * frequency) / 48_000.0;
            let sample = phase.sin() * 0.5;
            left[n] = sample;
            right[n] = sample;
        }
        engine.process_block(&mut left, &mut right);
        left
    }

    #[test]
    fn should_pass_signal_through_at_unity_gain() {
        let mut engine = YourEngine::new(48_000.0);
        engine.set_param("gain", 1.0);
        let output = process_sine(&mut engine, 220.0, 4096);
        let rms: f32 = (output.iter().map(|s| s * s).sum::<f32>() / output.len() as f32).sqrt();
        assert!((rms - 0.354).abs() < 0.01); // sine @ 0.5 amplitude → RMS ≈ 0.354
    }
}
```

### Native command tests

Command bodies in `crates/sourdaw-native/src/commands/` carry in-crate `#[cfg(test)]` coverage. Add command tests beside the Rust module they exercise; test the body directly rather than routing through the desktop shell's IPC.

---

## 9. Running tests

| Command                                      | Purpose                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:watch`                            | Vitest watch mode for active development                                                                                                       |
| `pnpm test:run <target>`                     | Single run; pass a file or narrow directory to stay focused. Bare `pnpm test:run` runs the full suite — do that only when explicitly requested |
| `pnpm test:coverage`                         | Full Vitest run with **v8** coverage; run only when explicitly requested                                                                       |
| `pnpm test:e2e <spec>`                       | Playwright run; pass a spec to stay focused. Bare `pnpm test:e2e` runs the full suite — do that only when explicitly requested                 |
| `pnpm typecheck:test`                        | Spec-inclusive type check (`tsconfig.test.json`)                                                                                               |
| `pnpm cargo:test --package <crate> <filter>` | Run affected Rust tests in debug mode                                                                                                          |

Run only checks affected by the changed files. Never expand to repository-wide tests, lint,
coverage, E2E, builds, Cargo, WASM, or measurements unless explicitly requested. Run checks
sequentially through `package.json`. The scripts themselves are plain, standard commands; in
agent sessions, wrap compute-heavy runs with `pnpm guard --profile <p> -- <command>`, which
rejects concurrent validation, low-memory starts, timeouts, and process trees above the
configured RSS ceiling. A guard refusal is final; never bypass it by rerunning unguarded.

Vitest config is in `vite.config.ts` (`test` and `test.coverage` blocks). Global setup is `src/setupTests.ts`, which loads `@testing-library/jest-dom`. Coverage uses `@vitest/coverage-v8`.

Spec files are excluded from the app `pnpm typecheck` (`tsconfig.app.json` excludes `src/**/*.spec.ts(x)`), so `pnpm typecheck:test` is the only gate that type-checks them. Run it whenever you touch a spec, a dummy factory, or a model shape that fixtures mirror. It must stay at zero errors — fix fixtures to the real types; never silence with `any` or `@ts-expect-error`.

---

## 10. Anti-patterns

Do not:

- **Build cross-module integration flows in Vitest.** Keep real collaborator use focused within one owner, such as one subscriber with an in-memory EventBus; use Playwright only when a user flow genuinely needs end-to-end coverage.
- **Test real Web Audio rendering.** AudioContext-in-jsdom does not exist. Use the mock from §7.4.
- **Mock event payloads or `AppError` values.** They are cheap plain objects. Construct them for real.
- **Write React Query tests.** This codebase does not use TanStack Query for core state — state flows through `Store<T>`.
- **Depend on real time.** No `setTimeout` in tests, no real `AudioContext.currentTime`, no real `Date.now()` assertions. Use fake timers (`vi.useFakeTimers()`) or explicit values.
- **Share mutable state between tests.** Every test sets up its own dummies, its own mocks, its own store instances. `beforeEach` resets.
- **Rely on the Container's lazy proxy.** Tests run in strict mode — `Container.get()` throws on missing tokens. Use `injectDependencies` or register your fakes explicitly.
- **Cast spy methods to `Mock`.** If you find yourself writing `(spyObject.method as unknown as Mock).mockReturnValue(...)`, the subject isn't using `spy<T>()`. Rebuild the spy with `spy<T>()` so method types carry `Mock` natively.
- **Forget a mock in `injectDependencies`.** The helper throws if you do — don't disable the check. Every dep gets a mock, even the ones you "don't care about" (use `spy<T>()` with no overrides for those).
- **Snapshot-test dynamic UI.** Snapshots are for stable, literal structure. If a component renders varying content, assert on the content explicitly.
- **Leak mocks across files.** Module-level `vi.mock(...)` is scoped to its spec file — but be disciplined and don't rely on test-file ordering.
