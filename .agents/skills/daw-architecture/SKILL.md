---
name: daw-architecture
description: >
    Apply when creating, editing, or refactoring any module in the DAW codebase.
    Enforces DDD boundaries, three-tier state ownership, real-time audio constraints,
    cross-module sharing rules, and engine/store patterns.
    Apply even when the user says "create a module", "add a hook", "add state",
    "use case", "repository", "store", "engine", "audio", "MIDI", "plugin",
    "track", "clip", "transport", "mixer", or "project".
---

## Non-negotiable rules — read these first

### Module boundary: only 4 folders are public contracts

Only these folders may be imported by other modules:

```
useCases/              → business operations + exported DTOs
events/                → DomainEvent subclasses
errors/                → AppError subclasses
presentations/views/   → composable UI entry points
```

**Every other folder is private to its module.** This includes:

```
models/                     ← NEVER import from another module
repositories/               ← NEVER import from another module
transformers/               ← NEVER import from another module
helpers/                    ← NEVER import from another module
engine/                     ← NEVER import from another module
presentations/stores/       ← NEVER import from another module
presentations/hooks/        ← NEVER import from another module
presentations/components/   ← NEVER import from another module
```

```typescript
// ❌ All of these are forbidden from another module
import type { Track } from '#/modules/Arrangement/models/Track';
import { trackSelectionStore } from '#/modules/Arrangement/presentations/stores/trackSelectionStore';
import { transformTrack } from '#/modules/Arrangement/transformers/transformTrack';
import { getTrackByIdApi } from '#/modules/Arrangement/repositories/getTrackByIdApi';
import { useTrackControls } from '#/modules/Arrangement/presentations/hooks/useTrackControls';
import { TrackRow } from '#/modules/Arrangement/presentations/components/TrackRow';

// ✅ These are allowed
import type { TrackDto } from '#/modules/Arrangement/useCases/getTrackById'; // DTO from contract
import { getTrackById } from '#/modules/Arrangement/useCases/getTrackById';
import { TrackNotFoundError } from '#/modules/Arrangement/errors/TrackNotFoundError';
import { TrackAddedEvent } from '#/modules/Arrangement/events/TrackAddedEvent';
import { TrackListView } from '#/modules/Arrangement/presentations/views/TrackListView';
import type { TrackId } from '#/shared/types/ids'; // shared primitives — not a module
```

### Models are not DTOs — never export a model across modules

A **model** is the module's private internal type. A **DTO** is the minimal public contract exported from `useCases/`. They are different types. The consuming module maps the DTO to its own local type immediately.

```typescript
// ✅ Correct: Track/useCases/getTrackById.ts exports a DTO, not the model
export type TrackDto = {
    // ← this is the cross-module contract
    id: TrackId;
    name: string;
    kind: TrackKind;
    isMuted: boolean;
    isArmed: boolean;
    // gainDb, pluginChain, etc. are intentionally excluded
};

// Track/models/Track.ts is NEVER imported by Clip, Mixer, Transport, or anyone else
```

---

## State: four tiers, never mixed

| Tier                          | Where it lives                                                | Contract?  | What goes here                                |
| ----------------------------- | ------------------------------------------------------------- | ---------- | --------------------------------------------- |
| **Cross-module shared state** | `Store<T>` in `stores/` at **business layer**                 | ✅ Yes     | Project data, MIDI device list, engine status |
| **Persistent UI state**       | `Store<T>` + `LocalStorageStorage` in `presentations/stores/` | ❌ Private | Zoom level, sidebar open, panel layout        |
| **Ephemeral UI state**        | React context in `presentations/context/`                     | ❌ Private | Selection, active tool, scroll position       |
| **Engine state**              | Class instances / `useRef`                                    | ❌ Private | `AudioContext`, `AudioNode`s                  |

The key distinction between the first two tiers is **location**. Outside `presentations/` = contract. Inside `presentations/` = private. Context is never shared across modules. Engine state is never in React state or a Store.

```typescript
// ❌ Wrong — AudioNode in React state
const [gainNode, setGainNode] = useState<GainNode>();

// ❌ Wrong — ephemeral UI state in a business layer store
export const arrangementStore = new Store(...); // at src/modules/Arrangement/stores/ — now it's a contract and shouldn't be

// ✅ Correct — AudioNode in engine class
private gainNode: GainNode;

// ✅ Correct — ephemeral UI state in context (presentations/context/)
const [selectedTrackId, setSelectedTrackId] = useState<TrackId | null>(null);

// ✅ Correct — persistent UI preference in presentations/stores/
export const arrangementPreferencesStore = new Store({ storage: new LocalStorageStorage('...') });

// ✅ Correct — shared cross-module state in business layer stores/
export const projectStore = new Store({ storage: new MemoryStorage() }); // at src/modules/Project/stores/
```

---

## Module structure

```
DomainName/
├── _tests/
├── models/            ← private: domain types
├── errors/            ← 🔗 CONTRACT
├── events/            ← 🔗 CONTRACT
├── useCases/          ← 🔗 CONTRACT (also where DTOs are exported)
├── repositories/      ← private: IO, engine adapters, Tauri IPC
├── engine/            ← private: stateful classes (AudioEngine, TrackNode)
├── worklets/          ← private: AudioWorkletProcessor implementations
├── transformers/      ← private: pure mapping functions
├── helpers/           ← private: domain utilities
└── presentations/
    ├── hooks/         ← private
    ├── stores/        ← private
    ├── components/    ← private
    └── views/         ← 🔗 CONTRACT
```

---

## Use cases

- Contain business logic only
- May call their own `repositories/` (including engine adapters and Tauri adapters)
- May call other modules' `useCases/` — never their `repositories/` or `models/`
- Write to `useProjectStore` for their own slice only
- Emit a `DomainEvent` after mutating state
- Use `inject()` when they have external dependencies

```typescript
// src/modules/Transport/useCases/setTempo.ts
export const setTempo = inject(
    { transportEngineAdapter },
    ({ transportEngineAdapter }) =>
        async (bpm: Bpm): Promise<void> => {
            if (bpm < 20 || bpm > 300) throw new InvalidTempoError(bpm);

            const prev = useProjectStore.getState().transport.bpm;

            // Write own slice only
            useProjectStore.setState((s) => ({
                transport: { ...s.transport, bpm },
            }));

            // Immediate engine update
            transportEngineAdapter.setTempo(bpm);

            // Notify other domains
            eventBus.emit(new TempoChangedEvent({ previousBpm: prev, newBpm: bpm }));
        }
);
```

---

## Repositories: the I/O boundary

Repositories are thin adapters around external I/O. **One function per file.** They do NOT contain business logic, validation, or orchestration. A repository touches:

- **DOM / Canvas / WebGL / WebGPU** — any browser rendering API
- **Web Audio API** — AudioContext, AudioNodes, AudioWorklet
- **localStorage / IndexedDB** — client-side storage
- **fetch / WebSocket** — network I/O
- **Tauri invoke / listen** — native IPC
- **Third-party libraries** — anything with side effects

### Two kinds

**Engine adapter** — bridges a use case to the audio engine class. The only place engine methods are called.

```typescript
// src/modules/Mixer/repositories/mixerEngineAdapter.ts
import { audioEngine } from '#/modules/AudioEngine/engine/AudioEngine';

export const setChannelGainInEngine = (trackId: TrackId, gainDb: Decibels): void => {
    audioEngine.setTrackGain(trackId, dbToLinear(gainDb));
};
```

**Tauri adapter** — wraps `invoke`/`listen`. The only place Tauri IPC is called. Never call `invoke` directly from a use case.

```typescript
// src/modules/MIDI/repositories/midiTauriAdapter.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const listMidiPorts = (): Promise<MidiDevice[]> => invoke('list_midi_ports');
export const onMidiMessage = (handler: (e: MidiEvent) => void) =>
    listen<MidiEvent>('midi-message', (e) => handler(e.payload));
```

---

## Engine classes

Use classes for anything that owns Web Audio resources. Keep them inside `engine/` — private to their domain.

```typescript
// src/modules/AudioEngine/engine/AudioEngine.ts
export class AudioEngine {
    private context!: AudioContext;
    private masterGain!: GainNode;
    private trackNodes = new Map<TrackId, TrackNode>();

    async initialize(): Promise<void> {
        this.context = new AudioContext({ latencyHint: 'playback' });
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);
    }

    // Called by Zustand subscription — diffs old/new state, updates only what changed
    reconcileTracks(next: ReadonlyArray<Track>, prev: ReadonlyArray<Track>): void {
        const removed = prev.filter((t) => !next.find((n) => n.id === t.id));
        const added = next.filter((t) => !prev.find((p) => p.id === t.id));
        removed.forEach((t) => {
            this.trackNodes.get(t.id)?.dispose();
            this.trackNodes.delete(t.id);
        });
        added.forEach((t) => {
            const n = new TrackNode(this.context, t);
            n.connect(this.masterGain);
            this.trackNodes.set(t.id, n);
        });
    }

    // Direct AudioParam mutation — no React state, no store
    setTrackGain(trackId: TrackId, linear: LinearGain): void {
        this.trackNodes.get(trackId)?.gainNode.gain.setTargetAtTime(linear, this.context.currentTime, 0.01);
    }

    dispose(): void {
        this.trackNodes.forEach((n) => n.dispose());
        this.context.close();
    }
}

export const audioEngine = new AudioEngine(); // module-level singleton
```

---

## projectStore: shared contract with ownership rules

`useProjectStore` is a cross-cutting concern. Any module may **read** any slice. Only the owning domain's use cases may **write** to a slice.

```typescript
// ✅ Any module can read any slice
const bpm = useProjectStore((s) => s.transport.bpm);
const trackCount = useProjectStore((s) => s.tracks.length);
const gainDb = useProjectStore((s) => s.mixer.channels.find((c) => c.trackId === id)?.gainDb);

// ✅ Engine subscribes to specific slices — no re-renders
useProjectStore.subscribe(
    (s) => s.transport,
    (t) => audioEngine.reconcileTransport(t)
);
useProjectStore.subscribe(
    (s) => s.tracks,
    (next, prev) => audioEngine.reconcileTracks(next, prev)
);

// ❌ Only the owning domain writes its slice
// Transport use case may write state.transport
// Track use case may write state.tracks
// Mixer use case may write state.mixer
// — never the other way around
```

Slice ownership:

| Slice              | Owner      |
| ------------------ | ---------- |
| `state.transport`  | Transport  |
| `state.tracks`     | Track      |
| `state.clips`      | Clip       |
| `state.mixer`      | Mixer      |
| `state.plugins`    | Plugin     |
| `state.automation` | Automation |
| `state.meta`       | Project    |

---

## Real-time display: bypass React

Anything updating at 30–60fps (meters, transport position) must **not** go through React state or a Store. Use `requestAnimationFrame` + DOM refs + canvas.

```typescript
// ✅ Correct — 60fps position display, zero re-renders
useEffect(() => {
    let rafId: number;
    const update = () => {
        if (ref.current) ref.current.textContent = formatTimecode(audioEngine.getCurrentPosition());
        rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
}, []);

// ❌ Wrong — causes 60 React re-renders per second
const [position, setPosition] = useState(0);
useEffect(() => {
    const id = setInterval(() => setPosition(audioEngine.getCurrentPosition()), 16);
    return () => clearInterval(id);
}, []);
```

---

## Continuous gestures: direct then commit

During drag (fader, knob, clip resize): update the engine directly for zero latency.
On release: commit to `projectStore` and the undo stack as a single coalesced command.

```typescript
const onDrag = (gainDb: Decibels) => audioEngine.setTrackGain(trackId, dbToLinear(gainDb)); // no store
const onDragEnd = (gainDb: Decibels) =>
    executeCommand({ type: 'SET_CHANNEL_GAIN', payload: { trackId, previousGainDb: start, gainDb } });
```

---

## Shared primitives — `src/shared/`

Cross-cutting types and helpers live outside `modules/`. Any module imports them freely — not a boundary violation.

```
src/shared/
├── types/
│   ├── ids.ts        # TrackId, ClipId, PluginId (branded strings)
│   ├── time.ts       # Beats, Seconds, Samples, Bpm
│   ├── audio.ts      # Decibels, LinearGain, Pan
│   └── midi.ts       # MidiNote, MidiChannel, MidiVelocity
└── helpers/
    └── conversions.ts  # dbToLinear, beatsToSeconds
```

Use branded types everywhere — they prevent passing a `ClipId` where a `TrackId` is expected.

---

## Domain events

Every cross-domain side effect goes through `eventBus`, not direct function calls.
Emit from use cases. Subscribe from other use cases (at app bootstrap) or React hooks (with `useEffectEvent` + cleanup).

```typescript
// Emit
eventBus.emit(new TrackAddedEvent({ trackId: track.id, kind: track.kind }));

// Subscribe (non-React)
eventBus.on(TrackAddedEvent, (e) => audioEngine.addTrack(e.payload.trackId));

// Subscribe (React hook — always return unsubscribe)
useEffect(() => eventBus.on(TrackAddedEvent, handler), []);
```

---

## Quick decisions

| Situation                                    | Answer                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| Need a type from another module              | Export a DTO from their `useCases/`                             |
| Need another module's store value            | Read `projectStore` with a selector                             |
| Need to trigger another module's logic       | Call their `useCases/` or emit an event                         |
| Need an identifier shared by many modules    | `src/shared/types/ids.ts` branded type                          |
| Need to read cross-module state in a hook    | `useSyncExternalStore` against a business layer store           |
| Need to update a parameter during drag       | `AudioParam` direct set — no store                              |
| Need UI state shared within a module subtree | React context in `presentations/context/`                       |
| Need UI state that survives refresh          | `Store<T>` + `LocalStorageStorage` in `presentations/stores/`   |
| Need state shared across modules             | `Store<T>` in `stores/` at business layer (contract)            |
| Need to display something at 60fps           | `requestAnimationFrame` + DOM ref — no React state              |
| Need to call a Tauri command                 | In `repositories/` adapter only                                 |
| Need to touch an AudioNode                   | Inside `engine/` class only                                     |
| AudioContext lifecycle                       | Use case calls `audioEngine.initialize()` on first user gesture |

---

## Forbidden anti-patterns — do not attempt these

These are bypass techniques that technically pass `depcruise` but violate the spirit of the architecture. They are **all forbidden**.

### 1. Barrel re-exports to bypass boundaries

Creating a file in a contract folder that simply re-exports something from a private folder. This does not make the private thing public — it makes the contract folder dishonest.

```typescript
// ❌ FORBIDDEN: presentations/views/fooContract.ts that just re-exports a private hook
export { useFoo } from '../hooks/useFoo';

// ❌ FORBIDDEN: presentations/hooks/useFoo.ts that just re-exports from another module's view
export { useFoo } from '#/modules/Other/presentations/views/fooContract';

// ❌ FORBIDDEN: chaining two barrel re-exports to launder a private import
// Module A: views/contract.ts → re-exports hooks/impl.ts (bypass #1)
// Module B: hooks/local.ts → re-exports Module A views/contract.ts (bypass #2)
```

**The correct approach:** If multiple modules need the same logic, each module re-implements its own hook using the shared store (contract) directly. Hooks are private — they are never shared.

### 2. Sharing hooks across modules

Hooks in `presentations/hooks/` are **private to the module**. No module may import another module's hooks. No barrel re-export, proxy file, or view-layer wrapper changes this.

```typescript
// ❌ FORBIDDEN: importing another module's hook, even indirectly
import { useTracks } from '#/modules/Arrangement/presentations/hooks/useTracks';

// ✅ CORRECT: re-implement the hook locally using the store (a contract)
import { useSyncExternalStore } from 'react';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
export const useTracks = () =>
    useSyncExternalStore(
        (cb) => trackStore.subscribe(() => cb()),
        () => trackStore.value?.tracks ?? [],
        () => []
    );
```

### 3. `export *` wildcard re-exports

Never use `export *` when re-exporting from another module's use cases. Wildcard re-exports hide what is actually being shared, make it impossible to audit the public surface, and silently pick up new exports over time.

```typescript
// ❌ FORBIDDEN
export * from '#/modules/Arrangement/useCases/presetUseCases';
export * from '#/modules/Transport/useCases/transportControls';

// ✅ CORRECT: explicit named exports only
export { getUserPresets, saveUserPreset } from '#/modules/Arrangement/useCases/presetUseCases';
export { togglePlayback, stopPlayback } from '#/modules/Transport/useCases/transportControls';
```

### 4. Importing from private `models/` cross-module (even type-only)

Type-only imports from another module's `models/` are still forbidden. The type boundary is the same as the value boundary. If you need a type cross-module, it must be re-exported from the owning module's `useCases/` (as a DTO or query re-export).

```typescript
// ❌ FORBIDDEN: even though it's type-only
import { type AppAction } from '#/modules/Command/models/AppAction';
import { type SidechainRoute } from '#/modules/AudioEngine/models/SidechainRoute';
import { type Track } from '#/modules/Arrangement/models/Track';

// ✅ CORRECT: import from the use case / query layer
import { type AppAction } from '#/modules/Command/useCases/commandQueries';
import { type SidechainRoute } from '#/modules/AudioEngine/useCases/sidechainUseCases';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';
```

### 5. Components importing use cases

Components in `presentations/components/` are **pure rendering units**. They receive data and DOM callbacks as props. They do NOT import use cases, stores, or contain business logic.

If a "component" imports use cases, it is actually a **view** and belongs in `presentations/views/`.

```typescript
// ❌ FORBIDDEN: component importing use cases
// presentations/components/transport/UndoRedoButtons.tsx
import { undo, redo } from '../../../useCases/workspaceViewActions';

// ✅ CORRECT: either promote to views/ or make the component pure
// Option A: Move to presentations/views/transport/UndoRedoButtons.tsx (it's a view)
// Option B: Accept callbacks as props
export const UndoRedoButtons = ({ onUndo, onRedo, canUndo, canRedo }: Props) => (
    <button disabled={!canUndo} onClick={onUndo}>Undo</button>
    <button disabled={!canRedo} onClick={onRedo}>Redo</button>
);
```

### 6. Passing use case functions as component props to work around the rule

Do not take a file that should be a view and keep it as a component by passing use case functions down as props from a parent. If the component has enough business logic to warrant interaction with use cases, **it is a view**.

```typescript
// ❌ FORBIDDEN: keeping it as a component and passing use cases as props
<TrackHeader
    track={track}
    onRename={renameTrack}         // use case passed as prop
    onFreeze={freezeTrack}         // use case passed as prop
    onSetColor={setTrackColor}     // use case passed as prop
/>

// ✅ CORRECT: promote to a view — views orchestrate business logic
// presentations/views/inspector/TrackHeader.tsx
import { renameTrack, freezeTrack, setTrackColor } from '../../useCases/workspaceViewActions';
```

The distinction: a **pure component** receives primitive data + DOM callbacks (`onChange`, `onClick`). A **view** imports use cases and wires business logic. If the parent is just proxying use cases to the child, the child is a view.
