# Testing

This codebase currently has zero TypeScript tests. This document defines how we add them — deliberately, incrementally, and with one consistent shape per layer.

---

## 1. Philosophy

- **Shallow unit tests only.** Every test exercises one function, one class, or one component in isolation. Every dependency that crosses a module boundary, touches the OS, or hits the audio thread is mocked at the import boundary.
- **No integration tests. No E2E.** Not yet. Adding cross-module or Playwright-style tests before the unit layer is populated is premature — wire up the skeleton first, then grow outward when we have a real reason to.
- **One test file per source file.** Co-located: `addTrack.ts` sits next to `addTrack.spec.ts`. If a source file is hard to unit-test, that is a signal about the source file, not the tests.
- **Mock surface dependencies, not internals.** When testing a use case, mock the repositories it calls. When testing a repository, mock `@tauri-apps/api/core` or `AudioContext`. When testing a transformer, mock nothing — it is pure.
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

- Real Tauri IPC round-trips
- Real Web Audio rendering (AudioWorklet output, scheduler correctness with real time)
- Real Automerge document convergence
- Cross-module flows end-to-end
- The DI Container's lazy-proxy behaviour — tests register fakes explicitly before reading
- React components rendered against real stores — mock the store
- The audio thread itself — audio-thread constraints (no allocation, no locks, no blocking) are enforced by code review, not by tests

---

## 3. File layout

Tests live next to the code they test. Shared test utilities live in a `_tests/` folder at the module root.

```text
src/modules/Arrangement/
├── _tests/
│   ├── TrackDummy.ts              # dummy factory
│   ├── ClipDummy.ts
│   └── eventBus.mock.ts           # module-local event bus mock (if needed)
├── useCases/
│   ├── addTrack.ts
│   └── addTrack.spec.ts           # co-located
├── repositories/
│   ├── track.ts
│   └── track.spec.ts
├── transformers/
│   ├── automationTransformers.ts
│   └── automationTransformers.spec.ts
└── presentations/
    └── hooks/
        ├── useTracks.ts
        └── useTracks.spec.ts
```

Cross-module test utilities (mock `AudioContext`, `Container` helpers) live in `src/helpers/_tests/`. DI and event test helpers live in `src/infra/di/testing/` and `src/infra/events/testing/`.

---

## 4. Naming convention

Every `it` block starts with `should` or `should not`, followed by a concise description of the behaviour under test:

- `it('should add the track and emit TrackAddedEvent')`
- `it('should not emit when the store is empty')`
- `it('should throw InvalidTempoError when bpm is below 20')`

---

## 5. Dependency injection in tests

The business layer uses the `inject()` DI pattern (see `docs/architecture/03-typescript-module.md §4.10`). Tests for injectable functions **must** use the companion test helpers rather than `vi.mock()`:

- **`inject(deps)(factory)`** — `#/infra/di/inject` — curried DI wrapper. The first call takes a dependency map, the second takes a factory that receives resolved deps. The wrapped function carries `.dependencies`, `.factory`, and `.token` as metadata for tests.
- **`injectDependencies(subject, mocks)`** — `#/infra/di/testing/injectDependencies` — resets the `Container` and registers a **complete** set of mocks against the subject's dependencies. Throws if a dependency is missing from `mocks` or if `mocks` contains a key the subject doesn't have. Returns the subject for chaining.
- **`spy<T>(overrides?)`** — `#/infra/di/testing/spy` — creates a typed spy. Every accessed method is a `vi.fn()` typed to the original signature — no casts needed. Optional `overrides` pre-seed specific methods or properties (function overrides stay assertable as `vi.fn()`).

### When to use which

| Subject under test                                              | Mock its deps with                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| An injectable (function wrapped in `inject()`)                  | `spy<T>()` + `injectDependencies()`                                              |
| An external module you don't own (`@tauri-apps/api/core`, etc.) | `vi.mock(modulePath, ...)`                                                       |
| An internal module that is NOT wrapped with `inject()`          | `vi.mock()` as a fallback — but prefer refactoring the subject to use `inject()` |

Do not mix `vi.mock()` with `injectDependencies()` for the same dependency. Pick one.

### Canonical test shape for an injectable

```typescript
import { describe, it, expect } from 'vitest';
import { spy } from '#/infra/di/testing/spy';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { Logger } from '#/helpers/Logger/Logger';
import { TrackRepo } from '../repositories/TrackRepo';
import { addTrack } from './addTrack';

describe('addTrack', () => {
    it('should append the track to the repo and emit track.added', () => {
        const trackRepo = spy<TrackRepo>({
            getState: () => ({ tracks: [], selectedTrackId: null }),
        });
        const eventBus = spy<{ emit: (event: string, payload: unknown) => Promise<void> }>();
        const logger = spy<Logger>();

        injectDependencies(addTrack, { trackRepo, eventBus, logger });

        const result = addTrack({ name: 'Drums', kind: 'audio' });

        expect(result).not.toBeNull();
        expect(trackRepo.setState).toHaveBeenCalledWith(
            expect.objectContaining({
                tracks: [result],
                selectedTrackId: result!.id,
            })
        );
        expect(eventBus.emit).toHaveBeenCalledWith('track.added', expect.objectContaining({ name: 'Drums' }));
    });

    it('should return null when the repo state is uninitialized', () => {
        const trackRepo = spy<TrackRepo>({ getState: () => null });
        const eventBus = spy<{ emit: (event: string, payload: unknown) => Promise<void> }>();
        const logger = spy<Logger>();

        injectDependencies(addTrack, { trackRepo, eventBus, logger });

        expect(addTrack({ name: 'Drums', kind: 'audio' })).toBeNull();
        expect(trackRepo.setState).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});
```

Notes on this shape:

- `injectDependencies` calls `Container.reset()` before registering mocks and throws if any dependency is missing a mock — tests cannot accidentally leak state or forget a dep.
- `spy<T>()` returns a typed object where every accessed method is a `vi.fn()` typed to the original signature. `trackRepo.setState.toHaveBeenCalledWith(...)` works with no cast.
- Inline overrides (`{ getState: () => (...) }`) are wrapped in `vi.fn(impl)` automatically — they still record calls, they just have a default implementation.
- Every test builds fresh spies. No `beforeEach` is needed for container or spy cleanup.

---

## 6. How to test each layer

Every example below uses a real file from the codebase as its subject.

### 6.1 Use cases

Subject: `src/modules/Arrangement/useCases/addTrack.ts` — wrapped with `inject()`, reads a repo, writes the repo, emits an event.

Use the canonical shape from §5: `spy<T>()` + `injectDependencies()`. No `vi.mock()`, no casts.

```typescript
// src/modules/Arrangement/useCases/addTrack.spec.ts
import { describe, it, expect } from 'vitest';
import { spy } from '#/infra/di/testing/spy';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { Logger } from '#/helpers/Logger/Logger';
import { TrackRepo } from '../repositories/TrackRepo';
import { addTrack } from './addTrack';
import { TrackDummy } from '../_tests/TrackDummy';

describe('addTrack', () => {
    it('should append the track to the repo and emit track.added', () => {
        const existing = TrackDummy.create({ id: 'track-1' });
        const trackRepo = spy<TrackRepo>({
            getState: () => ({ tracks: [existing], selectedTrackId: 'track-1' }),
        });
        const eventBus = spy<{ emit: (event: string, payload: unknown) => Promise<void> }>();
        const logger = spy<Logger>();

        injectDependencies(addTrack, { trackRepo, eventBus, logger });

        const result = addTrack({ name: 'Lead Vocals', kind: 'audio' });

        expect(result).not.toBeNull();
        expect(trackRepo.setState).toHaveBeenCalledWith({
            tracks: [existing, result],
            selectedTrackId: result!.id,
        });
        expect(eventBus.emit).toHaveBeenCalledWith('track.added', expect.objectContaining({ name: 'Lead Vocals' }));
    });

    it('should return null and not emit when the repo is uninitialized', () => {
        const trackRepo = spy<TrackRepo>({ getState: () => null });
        const eventBus = spy<{ emit: (event: string, payload: unknown) => Promise<void> }>();
        const logger = spy<Logger>();

        injectDependencies(addTrack, { trackRepo, eventBus, logger });

        const result = addTrack({ name: 'Lead Vocals', kind: 'audio' });

        expect(result).toBeNull();
        expect(trackRepo.setState).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});
```

Notes:

- Event payloads are plain objects — assert on the string key and payload shape directly.
- `injectDependencies` resets the Container and validates the mock map — no `beforeEach` reset is needed.
- If `addTrack` is not yet wrapped with `inject()`, that refactor comes _with_ the test. See `docs/architecture/03-typescript-module.md §4.10`.

### 6.2 Repositories — Tauri IPC

Subject: `src/modules/CrdtDocument/repositories/nativeCrdtPersistence.ts` — wraps Tauri `invoke`.

Mock `@tauri-apps/api/core` at the module boundary.

```typescript
// src/modules/CrdtDocument/repositories/nativeCrdtPersistence.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { nativeCreateProject } from './nativeCrdtPersistence';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('nativeCreateProject', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should invoke collab_create_project with the given name and sample rate', async () => {
        vi.mocked(invoke).mockResolvedValue(true);

        const result = await nativeCreateProject('My Project', 48000);

        expect(vi.mocked(invoke)).toHaveBeenCalledWith('collab_create_project', {
            name: 'My Project',
            sampleRate: 48000,
        });
        expect(result).toBe(true);
    });

    it('should return false when the native layer returns null', async () => {
        vi.mocked(invoke).mockResolvedValue(null);

        const result = await nativeCreateProject('My Project', 48000);

        expect(result).toBe(false);
    });
});
```

If the repository checks `isTauriAvailable()` and short-circuits when not in Tauri, also mock that helper and test both branches.

### 6.3 Repositories — Web Audio

Web Audio code is built on `AudioContext` and its node types. We provide a mock `AudioContext` factory (see §7.4) and assert on node wiring and parameter calls.

```typescript
// src/modules/AudioEngine/repositories/createWebAudioEngine.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createMockAudioContext } from '#/helpers/_tests/audioContext.mock';
import { createWebAudioEngine } from './createWebAudioEngine';

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
// src/modules/Arrangement/repositories/trackTemplate.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadTrackTemplates, saveTrackTemplates } from './trackTemplate';

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
// src/modules/Arrangement/transformers/automationTransformers.spec.ts
import { describe, it, expect } from 'vitest';
import { interpolateAutomationValue, rdpSimplify } from './automationTransformers';

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

describe('rdpSimplify', () => {
    it('should return the input unchanged when it has two or fewer points', () => {
        const points = [
            { beat: 0, value: 0 },
            { beat: 1, value: 1 },
        ];
        expect(rdpSimplify(points, 0.1)).toEqual(points);
    });
});
```

No mocks. No `beforeEach`. Input in, output out.

### 6.6 Validators and services

Treat exactly like transformers — pure functions, no mocks, input/output assertions. One file per validator, one `describe` per exported function.

### 6.7 Stores (the custom `Store<T>` class)

Subject: `src/helpers/Store/Store.ts`.

Instantiate the real `Store<T>` with `MemoryStorage`. Test the observable contract: `value`, `set`, `subscribe`, `notify`.

```typescript
// src/helpers/Store/Store.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { Store } from './Store';
import { MemoryStorage } from './Storage/MemoryStorage';
import { loggerMock } from './_tests/logger.mock';

describe('Store', () => {
    it('should return initialData from value when storage is empty', () => {
        const store = new Store<{ count: number }>(loggerMock, {
            storage: new MemoryStorage(),
            initialData: { count: 0 },
        });
        expect(store.value).toEqual({ count: 0 });
    });

    it('should notify subscribers on set', () => {
        const store = new Store<{ count: number }>(loggerMock, {
            storage: new MemoryStorage(),
            initialData: { count: 0 },
        });
        const subscriber = vi.fn();
        store.subscribe(subscriber);

        store.set({ count: 1 });

        expect(subscriber).toHaveBeenCalledWith({ count: 1 });
    });

    it('should return an unsubscribe function from subscribe', () => {
        const store = new Store<{ count: number }>(loggerMock, {
            storage: new MemoryStorage(),
            initialData: { count: 0 },
        });
        const subscriber = vi.fn();
        const unsubscribe = store.subscribe(subscriber);

        unsubscribe();
        store.set({ count: 1 });

        expect(subscriber).not.toHaveBeenCalled();
    });
});
```

### 6.8 Event subscribers

Files that wire a domain handler via `eventBus.on(...)`. For integration-style subscriber tests, use `createEventBus()` from `#/infra/events/createEventBus` to create a real bus, wire the subscriber, then emit events and assert on side effects.

```typescript
// src/modules/Toaster/useCases/toasterSubscriber.spec.ts
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
// src/modules/Arrangement/presentations/hooks/useTracks.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTracks } from './useTracks';
import { trackStore } from '../../stores/trackStore';
import { TrackDummy } from '../../_tests/TrackDummy';

vi.mock('../../stores/trackStore', () => ({
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

### 6.10 Presentation components

Use `@testing-library/react` from the user's perspective. Mock the use cases the component calls.

```typescript
// src/modules/Arrangement/presentations/components/AddTrackButton.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddTrackButton } from './AddTrackButton';
import { addTrack } from '../../useCases/addTrack';

vi.mock('../../useCases/addTrack', () => ({ addTrack: vi.fn() }));

describe('AddTrackButton', () => {
    it('should render the button label', () => {
        render(<AddTrackButton kind="audio" />);
        expect(screen.getByRole('button', { name: /add audio track/i })).toBeInTheDocument();
    });

    it('should call addTrack when clicked', () => {
        render(<AddTrackButton kind="audio" />);
        fireEvent.click(screen.getByRole('button'));
        expect(vi.mocked(addTrack)).toHaveBeenCalledWith({
            name: expect.any(String),
            kind: 'audio',
        });
    });
});
```

### 6.11 Engine classes

Subject: `src/modules/AudioEngine/engine/TrackNode.ts` — constructs an audio graph from an `AudioContext`.

Pass a mock `AudioContext` (see §7.4) via the constructor `deps`. Assert on the node connections and parameter calls — these are the only observable outputs of the class until the audio thread runs.

```typescript
// src/modules/AudioEngine/engine/TrackNode.spec.ts
import { describe, it, expect } from 'vitest';
import { TrackNode } from './TrackNode';
import { createMockAudioContext } from '#/helpers/_tests/audioContext.mock';

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

Each module owns factories for its domain models in `_tests/`. Factories accept a partial override and return a full, plausible instance.

```typescript
// src/modules/Arrangement/_tests/TrackDummy.ts
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

Alternatively, use `createEventBus()` from `#/infra/events/createEventBus` for a real bus in integration-style tests, paired with `recordEvents()` from `#/infra/events/testing/recordEvents` to capture emitted events.

For code that is not yet wrapped with `inject()` and reads the event bus at module scope, use `vi.mock('#/app/bootstrap', ...)` as a temporary bridge — but migrate the subject to `inject()` when the opportunity arises.

### 7.3 DI Container handling

For injectables wrapped with `inject()`, use `injectDependencies()` (§5). It:

1. Calls `Container.reset()`.
2. Validates that every dependency on the subject has a matching mock.
3. Registers each mock against the correct token.
4. Returns the subject for chaining.

Tests do not need manual container management and must not call `Container.reset()` themselves when using `injectDependencies`.

For the rare code that reads dependencies from `Container.getInstance()` directly (legacy / not yet migrated to `inject()`), reset and re-register manually before each test:

```typescript
import { Container } from '#/infra/di/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { spy } from '#/infra/di/testing/spy';

beforeEach(() => {
    const container = Container.getInstance();
    container.reset();
    container.register(Logger, spy<Logger>());
});
```

In dev/test, `Container.get()` throws when a token is missing (strict mode). Tests should fail loudly if a dependency isn't wired — don't rely on the production lazy-proxy fallback.

### 7.4 AudioContext mock

Cross-module helper in `src/helpers/_tests/audioContext.mock.ts`. It builds a fake `AudioContext` whose nodes expose spied `connect`/`disconnect` methods and typed `AudioParam` stubs.

```typescript
// src/helpers/_tests/audioContext.mock.ts
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

The `Store<T>` class accepts a `storage` option. Tests that need a store should build one with `new MemoryStorage()` rather than reaching for a mock. `MemoryStorage` is already in the codebase and is the correct tool for this.

If a module's store is defined as a module-level singleton (e.g. `export const trackStore = new Store(...)`), tests must either:

1. Mock the whole store module (as in §6.9), or
2. Call a reset helper exposed alongside the store that swaps its backing storage.

Prefer (1) unless the store is the subject under test.

### 7.6 Tauri availability

Repositories that check `isTauriAvailable()` before calling `invoke` need that check mocked:

```typescript
vi.mock('#/helpers/Tauri/isTauriAvailable', () => ({
    isTauriAvailable: vi.fn(() => true),
}));
```

Test both branches: the Tauri-available path (mock `invoke`) and the browser-only fallback path.

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

### Tauri backend tests

Commands in `src-tauri/src/commands/` are not currently tested. When we add tests, they will live in-crate as `#[cfg(test)]` modules and exercise the command functions directly — not the IPC layer.

---

## 9. Running tests

| Command                  | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `pnpm test`              | Vitest in watch mode — use during development |
| `pnpm test:run`          | Vitest single run — use in CI                 |
| `cargo test --workspace` | Run all Rust crate tests                      |
| `cargo test -p daw-dsp`  | Run tests for a single Rust crate             |

Vitest config is in `vite.config.ts` (`test` block). Global setup is `src/setupTests.ts`, which loads `@testing-library/jest-dom`.

---

## 10. Anti-patterns

Do not:

- **Write integration tests yet.** If a test can only be written by wiring up two modules' real code, delete it and write the unit tests for each module separately.
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
