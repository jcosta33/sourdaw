# DAW Architecture

This document defines the domain architecture for the DAW. It extends the base architecture guide with patterns specific to a real-time audio application: how the real-time boundary is respected, how each layer is structured within every domain, and how the module boundaries align with professional DAW domain concepts.

---

## Core principles

The base architecture principles (UI → Business → IO, contract-based boundaries, framework-independent use cases) all apply. Four additional constraints govern every decision here:

**The real-time boundary is inviolable.** The Web Audio callback runs every ~5.8ms at 44.1kHz/256 samples. Nothing on that path may allocate memory, dispatch React state updates, or acquire locks. All state that the audio thread reads must be prepared on the main thread and handed off via lock-free primitives (`AudioParam`, `SharedArrayBuffer` + `Atomics`, or atomic ref swaps). This boundary is the most architecturally significant boundary in the entire system — more important than any domain module boundary.

**Domain models are plain types. Engine objects are classes.** Domain entities — tracks, clips, automation lanes, mixer channels — are plain TypeScript types. They describe shapes, not behavior. Domain logic lives in use case functions, validators, and domain services — never in methods on the types themselves. Engine objects — `AudioEngine`, `TrackNode`, `PluginNode` — are inherently stateful: they own `AudioNode` instances, manage lifecycle (connect/disconnect/dispose), and must reconcile diffs between old and new project state. Classes with explicit lifecycle (`initialize`, `dispose`) are the right tool for these. Use classes only for anything that owns Web Audio resources or manages real-time state.

**The project store is the single source of truth.** All persistent, serializable, undoable state lives in the project store. The audio engine is a derived projection — it reads from the store via reconciliation subscriptions and never writes back to it. This is the CQRS pattern applied to audio: the domain model is the write model, the engine is a read model optimized for real-time execution. The engine owns only transient runtime state: DSP filter coefficients, delay line contents, reverb tails, metering levels, playback position.

**State has six tiers.** All state in the DAW falls into exactly one of:

| Tier                      | Where it lives                                         | Scope              | Examples                                     |
| ------------------------- | ------------------------------------------------------ | ------------------ | -------------------------------------------- |
| **Project state**         | `Store<T>` in `stores/` — contract                     | App-wide singleton | tracks, clips, BPM, plugin chains            |
| **Shared runtime state**  | `Store<T>` in `stores/` — contract                     | App-wide singleton | MIDI device list, engine ready status        |
| **Persistent UI state**   | `Store<T>` with `LocalStorageStorage` — module-private | Module             | user zoom preference, sidebar open           |
| **Ephemeral UI state**    | React context — module-private                         | Module subtree     | selected track, active tool, scroll position |
| **Local component state** | `useState`                                             | Component          | hover state, input draft value               |
| **Engine state**          | Class instances / `useRef`                             | Singleton          | AudioContext, AudioNodes, metering levels    |

Conflating these tiers is the primary source of bugs. Engine state is never in React state or a Store. Context is never shared across modules.

---

## Module structure

Each domain follows the base structure, extended with engine-specific layers. Modules are organized by **bounded context** — grouping concepts that change together and share invariants.

```
Arrangement/                # The core editing aggregate: timeline + tracks + clips
├── _tests/
├── models/                 # Track, Clip, ClipKind, TrackKind, Marker, TempoMap
├── errors/                 # 🔗 CONTRACT: TrackNotFoundError, ClipOverlapError
├── events/                 # 🔗 CONTRACT: TrackAddedEvent, ClipMovedEvent, ClipSplitEvent
├── useCases/               # 🔗 CONTRACT: addTrack, removeTrack, addClip, moveClip, splitClip
├── stores/                 # 🔗 CONTRACT: projectStore (cross-module shared state)
├── validators/             # validateClipPlacement, validateTrackDeletion
├── services/               # Domain services: no cross-cutting services needed yet
├── ports/                  # Port interfaces: ArrangementEnginePort
├── adapters/               # WebAudioArrangementAdapter, TauriArrangementAdapter
├── transformers/           # transformTrackToEngineConfig, serializeArrangement
└── presentations/
    ├── hooks/              # useTracks, useAddTrack, useClips, useMoveClip
    ├── stores/             # private: persistent UI preferences (LocalStorageStorage only)
    ├── context/            # private: ephemeral UI state (selectedTrackId, activeTool)
    └── views/              # 🔗 CONTRACT: ArrangementView, TrackHeaderView, ClipView

AudioEngine/                # Engine lifecycle and the real-time anti-corruption layer
├── models/                 # AudioGraphDescription, NodeDescriptor, ConnectionDescriptor
├── errors/                 # 🔗 CONTRACT: AudioEngineNotReadyError, AudioContextSuspendedError
├── events/                 # 🔗 CONTRACT: EngineStartedEvent, EngineStoppedEvent
├── useCases/               # 🔗 CONTRACT: initializeEngine, startEngine, getEngineStatus
├── stores/                 # 🔗 CONTRACT: engineStatusStore
├── ports/                  # 🔗 CONTRACT: AudioEnginePort interface, EngineTelemetryPort interface
├── adapters/               # WebAudioEngineAdapter, TauriEngineAdapter
├── engine/                 # Engine classes: AudioEngine, TrackNode, MixerNode (stateful, private)
├── worklets/               # AudioWorkletProcessor implementations (run in audio thread)
└── presentations/
    ├── hooks/              # useEngineStatus, useEngineInit
    └── views/              # 🔗 CONTRACT: views that compose engine hooks

Transport/
├── models/                 # TransportState, PlaybackMode, LoopRange, RecordMode
├── errors/                 # 🔗 CONTRACT: InvalidTempoError
├── events/                 # 🔗 CONTRACT: TransportStartedEvent, TempoChangedEvent
├── useCases/               # 🔗 CONTRACT: startTransport, stopTransport, setTempo, seekTo
├── stores/                 # 🔗 CONTRACT: transportStore
├── ports/                  # TransportEnginePort
├── adapters/               # transportWebAudioAdapter
└── presentations/
    ├── hooks/              # useTransportControls, usePlaybackPosition
    └── views/              # 🔗 CONTRACT: TransportBarView

Routing/                    # Audio graph topology: connections, sends, buses, cycle detection
├── models/                 # AudioGraph (DAG), Connection, SendRoute, BusConfig
├── errors/                 # 🔗 CONTRACT: RoutingCycleError, BusNotFoundError
├── events/                 # 🔗 CONTRACT: RoutingChangedEvent, SendAddedEvent
├── useCases/               # 🔗 CONTRACT: addSend, removeSend, addBus, setConnectionTarget
├── services/               # RoutingService: cycle detection (Kahn's algorithm), latency compensation
├── validators/             # validateRoutingGraph, detectCycles
└── presentations/
    ├── hooks/              # useRoutingGraph, useSends
    └── views/              # 🔗 CONTRACT: RoutingMatrixView

Automation/
├── models/                 # AutomationLane, Breakpoint, CurveType, AutomationMode
├── events/                 # 🔗 CONTRACT: BreakpointAddedEvent, AutomationModeChangedEvent
├── useCases/               # 🔗 CONTRACT: addBreakpoint, deleteBreakpoint, setAutomationMode
├── services/               # AutomationService: interpolation, curve evaluation, data thinning
├── adapters/               # automationEngineAdapter
└── presentations/
    ├── hooks/              # useAutomationLane, useAutomationMode
    └── views/              # 🔗 CONTRACT: AutomationLaneView

Plugin/
├── models/                 # PluginInstance, PluginParameter, PluginPreset, PluginFormat
├── errors/                 # 🔗 CONTRACT: PluginNotFoundError, PluginLoadError
├── events/                 # 🔗 CONTRACT: PluginAddedEvent, ParameterChangedEvent
├── useCases/               # 🔗 CONTRACT: addPlugin, removePlugin, setParameter, loadPreset
├── ports/                  # PluginHostPort
├── adapters/               # pluginTauriAdapter (Tauri IPC bridge for native CLAP/VST3)
└── presentations/
    ├── hooks/              # usePlugin, usePluginParameters
    └── views/              # 🔗 CONTRACT: PluginRackView, PluginEditorView

MIDI/
├── models/                 # MidiEvent, MidiDevice, MidiRoute, MpeState
├── events/                 # 🔗 CONTRACT: NoteOnEvent, NoteOffEvent, MidiDeviceConnectedEvent
├── useCases/               # 🔗 CONTRACT: connectMidiPort, sendMidiClock, routeMidiInput
├── ports/                  # MidiDevicePort
├── adapters/               # midiTauriAdapter (Tauri IPC bridge — midir in Rust)
└── presentations/
    ├── hooks/              # useMidiDevices, useMidiInput
    └── views/              # 🔗 CONTRACT: MidiRoutingView

Project/
├── models/                 # Project, ProjectMeta, ProjectSnapshot
├── errors/                 # 🔗 CONTRACT: ProjectLoadError, ProjectSaveError
├── events/                 # 🔗 CONTRACT: ProjectLoadedEvent, ProjectSavedEvent
├── useCases/               # 🔗 CONTRACT: loadProject, saveProject, newProject
├── ports/                  # ProjectPersistencePort
├── adapters/               # projectTauriAdapter (Tauri fs plugin), projectBrowserAdapter (IndexedDB)
├── transformers/           # serializeProject, deserializeProject
└── presentations/
    ├── hooks/              # useProjectMeta, useRecentProjects
    └── views/              # 🔗 CONTRACT: ProjectSettingsView

Command/                    # Cross-cutting: undo/redo with delta commands
├── models/                 # DeltaCommand, CompoundCommand, CoalesceGroup
├── useCases/               # 🔗 CONTRACT: executeCommand, undo, redo, beginCoalesce, endCoalesce
└── presentations/
    └── hooks/              # useUndo, useCommandHistory

Mixer/                      # PRESENTATION ONLY — no domain logic, reads from Arrangement + Routing
└── presentations/
    ├── hooks/              # useMixerChannel, useMasterOut, useMeters
    ├── context/            # private: mixer view state (channel strip width, scroll)
    └── views/              # 🔗 CONTRACT: MixerConsoleView, ChannelStripView
```

**Why this structure:**

- **Arrangement** merges the old Track and Clip modules. Clips exist as children of tracks — every operation (move clip, split clip, cross-track drag) crosses the old Track/Clip boundary. Grouping them eliminates friction for the most common editing operations and makes the aggregate boundary explicit.
- **Routing** is extracted from the old Mixer module. Audio routing (connections, sends, buses, cycle detection) is genuine domain logic with complex invariants. It deserves its own module with a domain service for graph validation.
- **Mixer** becomes presentation-only. The mixer UI is a view over Arrangement state (track volume, pan) and Routing state (sends, buses). It has no domain state of its own — it reads from Arrangement and Routing and calls their use cases. This matches how Tracktion Engine, Ardour, and Ableton all structure their mixer: a UI view over the same data that appears in the arrangement.
- **AudioEngine** owns the anti-corruption layer between the domain and the real-time engine. All engine access from other modules goes through port interfaces defined here.

---

## State ownership in detail

### Project state — the Vanilla Store

The project store is the single source of truth for everything that gets serialized. It is a **pure data model** — no AudioNode references, no class instances, no functions.

```typescript
// src/modules/Project/stores/projectStore.ts

import { Store } from '#/helpers/Store/Store';

export type ProjectState = {
    meta: ProjectMeta;
    arrangement: ArrangementState; // tracks, clips, tempo map, markers
    routing: RoutingState; // connections, sends, buses
    plugins: ReadonlyArray<PluginInstance>;
    automation: ReadonlyArray<AutomationLane>;
    transport: TransportConfig;
};

export type ArrangementState = {
    tracks: ReadonlyArray<Track>;
    clips: ReadonlyArray<Clip>;
    tempoMap: TempoMap;
    timeSignature: TimeSignature;
    markers: ReadonlyArray<Marker>;
};

export type RoutingState = {
    connections: ReadonlyArray<Connection>;
    sends: ReadonlyArray<SendRoute>;
    buses: ReadonlyArray<BusConfig>;
};

export const projectStore = new Store<ProjectState>(defaultProjectState);
```

**Slice ownership map:**

| Store slice         | Owning domain | Who may write              |
| ------------------- | ------------- | -------------------------- |
| `state.arrangement` | Arrangement   | Arrangement use cases only |
| `state.routing`     | Routing       | Routing use cases only     |
| `state.plugins`     | Plugin        | Plugin use cases only      |
| `state.automation`  | Automation    | Automation use cases only  |
| `state.transport`   | Transport     | Transport use cases only   |
| `state.meta`        | Project       | Project use cases only     |

**Modules write to the store only through their own use cases.** No presentation layer and no cross-module use case writes to a shared store directly — they call the owning domain's use case, which performs the write.

**Modules read from the store freely.** Any module's hooks or use cases may read any slice via `useSyncExternalStore` or `store.subscribe()`.

### Engine reconciliation subscriptions

The engine subscribes to specific store slices and reconciles when they change. This runs outside React — no re-renders, no hooks.

```typescript
// src/modules/AudioEngine/engine/setupReconciliation.ts

export const setupReconciliation = (engine: AudioEngine, store: Store<ProjectState>): void => {
    // Topology changes (slow path — rebuilds graph nodes)
    store.subscribe(
        (state) => state.arrangement.tracks,
        (tracks, prevTracks) => engine.reconcileTopology(tracks, prevTracks)
    );

    // Routing changes (slow path — rebuilds connections)
    store.subscribe(
        (state) => state.routing,
        (routing, prevRouting) => engine.reconcileRouting(routing, prevRouting)
    );

    // Parameter changes (fast path — updates atomics directly)
    store.subscribe(
        (state) =>
            state.arrangement.tracks.map((t) => ({ id: t.id, gainDb: t.gainDb, pan: t.pan, isMuted: t.isMuted })),
        (params) => engine.reconcileParams(params)
    );

    // Transport changes
    store.subscribe(
        (state) => state.transport,
        (transport) => engine.reconcileTransport(transport)
    );
};
```

**`subscribeWithSelector` is essential** — it lets the engine subscribe to specific slices of state without reacting to unrelated changes. Topology reconciliation (adding/removing tracks) must be separated from parameter reconciliation (volume/pan changes) because they have fundamentally different performance profiles.

### Engine state — class instances and refs

Engine objects are created once, stored in a module-level singleton or React ref, and never placed in React state, context, or a Store.

```typescript
// src/modules/AudioEngine/engine/AudioEngine.ts

export class AudioEngine {
    private context: AudioContext;
    private masterGain: GainNode;
    private trackNodes = new Map<string, TrackNode>();

    constructor() {
        // Not created here — lazy init on first user gesture
    }

    async initialize(): Promise<void> {
        this.context = new AudioContext({ latencyHint: 'playback' });
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);
        await this.context.audioWorklet.addModule('/worklets/transport-processor.js');
    }

    // Topology changes (slow path) — called by store subscription
    reconcileTopology(next: ReadonlyArray<Track>, prev: ReadonlyArray<Track>): void {
        const added = next.filter((t) => !prev.find((p) => p.id === t.id));
        const removed = prev.filter((t) => !next.find((n) => n.id === t.id));

        for (const track of removed) {
            this.trackNodes.get(track.id)?.dispose();
            this.trackNodes.delete(track.id);
        }
        for (const track of added) {
            const node = new TrackNode(this.context, track);
            node.connect(this.masterGain);
            this.trackNodes.set(track.id, node);
        }
    }

    // Parameter changes (fast path) — bypasses graph rebuild entirely
    reconcileParams(params: ReadonlyArray<{ id: string; gainDb: number; pan: number; isMuted: boolean }>): void {
        for (const p of params) {
            const node = this.trackNodes.get(p.id);
            if (!node) {
                continue;
            }
            node.gainNode.gain.setTargetAtTime(p.isMuted ? 0 : dbToLinear(p.gainDb), this.context.currentTime, 0.01);
            node.panNode.pan.setTargetAtTime(p.pan, this.context.currentTime, 0.01);
        }
    }

    dispose(): void {
        this.trackNodes.forEach((n) => n.dispose());
        this.context.close();
    }
}

// Module-level singleton — one per app lifetime
export const audioEngine = new AudioEngine();
```

### UI state — context and presentation stores

UI state that doesn't belong to the project splits into two sub-tiers based on whether it needs to survive a page refresh.

**Ephemeral UI state** (selection, active tool, scroll position) lives in React context scoped to the module's view subtree. It is created and consumed entirely within `presentations/` and never imported by another module.

```typescript
// src/modules/Arrangement/presentations/context/ArrangementContext.tsx

type ArrangementContextValue = {
    selectedTrackId: TrackId | null;
    selectedClipIds: ReadonlySet<ClipId>;
    activeTool: 'select' | 'draw' | 'erase' | 'split';
    scrollPosition: number;
    setSelectedTrackId: (id: TrackId | null) => void;
    setActiveTool: (tool: ArrangementTool) => void;
    setScrollPosition: (pos: number) => void;
};

const ArrangementContext = createContext<ArrangementContextValue | null>(null);

export const ArrangementProvider = ({ children }: { children: ReactNode }) => {
    const [selectedTrackId, setSelectedTrackId] = useState<TrackId | null>(null);
    const [selectedClipIds] = useState<ReadonlySet<ClipId>>(new Set());
    const [activeTool, setActiveTool] = useState<ArrangementTool>('select');
    const [scrollPosition, setScrollPosition] = useState(0);

    return (
        <ArrangementContext value={{
            selectedTrackId, selectedClipIds, activeTool, scrollPosition,
            setSelectedTrackId, setActiveTool, setScrollPosition,
        }}>
            {children}
        </ArrangementContext>
    );
};

export const useArrangementContext = () => {
    const ctx = use(ArrangementContext);
    if (!ctx) {
        throw new Error('useArrangementContext must be used within ArrangementProvider');
    }
    return ctx;
};
```

**Persistent UI state** (zoom level, sidebar open, panel layout) lives in a `Store<T>` with `LocalStorageStorage` inside `presentations/stores/`. This is the only acceptable use of a store inside `presentations/`. It is still module-private — never imported by another module.

```typescript
// src/modules/Arrangement/presentations/stores/arrangementPreferencesStore.ts

export const arrangementPreferencesStore = new Store<ArrangementPreferences>(Container.getInstance().get(Logger), {
    storage: new LocalStorageStorage('arrangement-preferences'),
    initialData: {
        zoomLevel: 100,
        snapToGrid: true,
    },
});
```

---

## Layer implementation patterns

### Models

Models are plain TypeScript types. They describe shapes, not behavior. Engine resources are never in models.

```typescript
// src/modules/Arrangement/models/Track.ts

export type TrackKind = 'audio' | 'midi' | 'instrument' | 'bus' | 'master';

export type Track = {
    id: TrackId;
    name: string;
    kind: TrackKind;
    color: string;
    isMuted: boolean;
    isSoloed: boolean;
    isArmed: boolean;
    gainDb: Decibels;
    pan: Pan;
    inputSource: string | null;
    pluginChainIds: ReadonlyArray<PluginId>;
};

// src/modules/Arrangement/models/Clip.ts

export type ClipKind = 'audio' | 'midi';

export type Clip = {
    id: ClipId;
    trackId: TrackId;
    kind: ClipKind;
    name: string;
    startBeats: Beats;
    durationBeats: Beats;
    color: string;
    fadeInBeats: Beats;
    fadeOutBeats: Beats;
    // Audio-specific
    audioFileId: string | null;
    audioOffsetBeats: Beats;
    // MIDI-specific
    notes: ReadonlyArray<MidiNote> | null;
};
```

**Why plain types, not classes:** TypeScript's immutable state stores, React's reconciliation via `Object.is()`, JSON serialization, the React Compiler's automatic memoization, and undo/redo snapshot diffing all expect plain serializable objects. Storing class instances requires hydration/dehydration on every read and write. Encoding domain rules in types (union types, branded types, mapped types) and enforcing them in validators and use case functions provides the same safety guarantees without the serialization overhead.

### Validators

Validators enforce aggregate invariants. They are pure functions that return `Result<void, DomainError>` and are shared across multiple use cases within the same module.

```typescript
// src/modules/Arrangement/validators/validateClipPlacement.ts

export const validateClipPlacement = (
    track: Track,
    existingClips: ReadonlyArray<Clip>,
    newClip: { startBeats: Beats; durationBeats: Beats; id?: ClipId }
): void => {
    const newEnd = newClip.startBeats + newClip.durationBeats;

    for (const existing of existingClips) {
        if (newClip.id && existing.id === newClip.id) {
            continue; // Skip self when validating a move
        }
        if (existing.trackId !== track.id) {
            continue;
        }
        const existingEnd = existing.startBeats + existing.durationBeats;
        if (newClip.startBeats < existingEnd && newEnd > existing.startBeats) {
            throw new ClipOverlapError(newClip.id ?? 'new', existing.id);
        }
    }
};
```

```typescript
// src/modules/Routing/validators/detectCycles.ts

// Kahn's algorithm — O(V+E) cycle detection on the routing DAG
export const detectCycles = (routing: RoutingState): ReadonlyArray<string> | null => {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Build adjacency list from connections and sends
    for (const conn of routing.connections) {
        if (!adjacency.has(conn.sourceId)) {
            adjacency.set(conn.sourceId, []);
        }
        adjacency.get(conn.sourceId)!.push(conn.targetId);
        inDegree.set(conn.targetId, (inDegree.get(conn.targetId) ?? 0) + 1);
        if (!inDegree.has(conn.sourceId)) {
            inDegree.set(conn.sourceId, 0);
        }
    }

    const queue: string[] = [];
    for (const [node, degree] of inDegree) {
        if (degree === 0) {
            queue.push(node);
        }
    }

    let visited = 0;
    while (queue.length > 0) {
        const node = queue.shift()!;
        visited++;
        for (const neighbor of adjacency.get(node) ?? []) {
            const newDegree = inDegree.get(neighbor)! - 1;
            inDegree.set(neighbor, newDegree);
            if (newDegree === 0) {
                queue.push(neighbor);
            }
        }
    }

    if (visited < inDegree.size) {
        // Cycle detected — return the nodes involved
        return [...inDegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
    }
    return null;
};
```

### Domain services

Domain services contain stateless business logic that spans multiple entities and doesn't belong in any single use case. They are plain exported functions — not classes.

```typescript
// src/modules/Automation/services/interpolateAutomation.ts

export const interpolateAutomation = (breakpoints: ReadonlyArray<Breakpoint>, positionBeats: Beats): number => {
    if (breakpoints.length === 0) {
        return 0;
    }
    if (breakpoints.length === 1) {
        return breakpoints[0].value;
    }

    // Find surrounding breakpoints
    let left = breakpoints[0];
    let right = breakpoints[breakpoints.length - 1];

    for (let i = 0; i < breakpoints.length - 1; i++) {
        if (breakpoints[i].positionBeats <= positionBeats && breakpoints[i + 1].positionBeats >= positionBeats) {
            left = breakpoints[i];
            right = breakpoints[i + 1];
            break;
        }
    }

    if (positionBeats <= left.positionBeats) {
        return left.value;
    }
    if (positionBeats >= right.positionBeats) {
        return right.value;
    }

    const t = (positionBeats - left.positionBeats) / (right.positionBeats - left.positionBeats);

    switch (left.curveType) {
        case 'linear':
            return left.value + t * (right.value - left.value);
        case 'exponential':
            return left.value * Math.pow(right.value / left.value, t);
        case 'hold':
            return left.value;
        default:
            return left.value + t * (right.value - left.value);
    }
};
```

```typescript
// src/modules/Routing/services/calculateLatencyCompensation.ts

export const calculateLatencyCompensation = (
    routing: RoutingState,
    pluginLatencies: ReadonlyMap<PluginId, Samples>
): ReadonlyMap<TrackId, Samples> => {
    // Calculate maximum cumulative latency across all parallel paths
    // Insert compensation delays on shorter paths
    // Returns the compensation delay per track
    // ...
};
```

### Ports and adapters

The old "repositories" layer is reclassified into **ports** (interfaces) and **adapters** (implementations). This distinction matters because the DAW targets both Tauri (native) and browser (web) environments.

**Ports** define the interface. They live in the domain module and express what the domain needs, not how it's implemented.

```typescript
// src/modules/AudioEngine/ports/AudioEnginePort.ts

export interface AudioEnginePort {
    initialize(): Promise<void>;
    dispose(): void;

    // Topology (slow path)
    reconcileTopology(tracks: ReadonlyArray<Track>, prevTracks: ReadonlyArray<Track>): void;
    reconcileRouting(routing: RoutingState, prevRouting: RoutingState): void;

    // Parameters (fast path)
    setTrackGain(trackId: TrackId, gainDb: Decibels): void;
    setTrackPan(trackId: TrackId, pan: Pan): void;

    // Transport
    play(): void;
    stop(): void;
    seekTo(positionBeats: Beats): void;

    // Metrics (read-only, for display)
    getCurrentPosition(): Seconds;
    getAnalyserNode(trackId: TrackId): AnalyserNode | null;
}
```

```typescript
// src/modules/AudioEngine/ports/EngineTelemetryPort.ts

export interface EngineTelemetryPort {
    subscribe(callback: (telemetry: EngineTelemetry) => void): () => void;
}

export type EngineTelemetry = {
    playbackPositionSeconds: Seconds;
    cpuLoadPercent: number;
    bufferUnderruns: number;
    meterLevels: ReadonlyMap<TrackId, { peakDb: Decibels; rmsDb: Decibels }>;
};
```

**Adapters** implement ports for specific platforms. They live in the domain module's `adapters/` folder.

```typescript
// src/modules/AudioEngine/adapters/WebAudioEngineAdapter.ts

export class WebAudioEngineAdapter implements AudioEnginePort {
    private engine: AudioEngine;

    constructor(engine: AudioEngine) {
        this.engine = engine;
    }

    async initialize(): Promise<void> {
        await this.engine.initialize();
    }

    setTrackGain(trackId: TrackId, gainDb: Decibels): void {
        this.engine.setTrackGain(trackId, dbToLinear(gainDb));
    }

    // ... all other methods delegate to the engine singleton
}
```

```typescript
// src/modules/MIDI/adapters/midiTauriAdapter.ts

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const createMidiTauriAdapter = (): MidiDevicePort => ({
    listPorts: () => invoke<MidiDevice[]>('list_midi_ports'),
    connect: (portIndex: number) => invoke('connect_midi_port', { portIndex }),
    onMessage: (handler) => listen<MidiEvent>('midi-message', (e) => handler(e.payload)),
});
```

**Tauri IPC is isolated to adapters.** Use cases never call `invoke` directly.

### Use cases

Use cases contain business logic only. They call ports (not engine classes directly), validate inputs, update the store, and emit domain events. **Each use case file exports exactly one function.**

```typescript
// src/modules/Arrangement/useCases/moveClip.ts

import { inject } from '#/helpers/DependencyInjector/inject';
import { eventBus } from '#/app/eventBus';
import { ClipMovedEvent } from '../events/ClipMovedEvent';
import { ClipNotFoundError } from '../errors/ClipNotFoundError';
import { validateClipPlacement } from '../validators/validateClipPlacement';
import { projectStore } from '#/modules/Project/stores/projectStore';

type MoveClipInput = {
    clipId: ClipId;
    targetTrackId: TrackId;
    newStartBeats: Beats;
};

export type MoveClipUseCase = (input: MoveClipInput) => void;

export const moveClip: MoveClipUseCase = (input) => {
    const state = projectStore.value!;
    const clip = state.arrangement.clips.find((c) => c.id === input.clipId);
    if (!clip) {
        throw new ClipNotFoundError(input.clipId);
    }

    const targetTrack = state.arrangement.tracks.find((t) => t.id === input.targetTrackId);
    if (!targetTrack) {
        throw new TrackNotFoundError(input.targetTrackId);
    }

    // Validate placement on target track
    validateClipPlacement(targetTrack, state.arrangement.clips, {
        id: clip.id,
        startBeats: input.newStartBeats,
        durationBeats: clip.durationBeats,
    });

    // Update store (single atomic update — one reconciliation call)
    projectStore.set({
        ...state,
        arrangement: {
            ...state.arrangement,
            clips: state.arrangement.clips.map((c) =>
                c.id === input.clipId ? { ...c, trackId: input.targetTrackId, startBeats: input.newStartBeats } : c
            ),
        },
    });

    // Emit event for other domains
    eventBus.emit(
        new ClipMovedEvent({
            clipId: input.clipId,
            fromTrackId: clip.trackId,
            toTrackId: input.targetTrackId,
            newStartBeats: input.newStartBeats,
        })
    );
};
```

Use cases **never** do I/O directly. If a use case needs to access localStorage, fetch data, call the audio engine, or invoke a Tauri command, that I/O belongs in a port/adapter. Use cases only orchestrate ports.

### Transformers

Transformers map between domain models and other representations. They are pure functions with no side effects.

```typescript
// src/modules/Arrangement/transformers/transformTrackToEngineConfig.ts

export type TrackEngineConfig = {
    id: TrackId;
    gainLinear: LinearGain;
    pan: Pan;
    isMuted: boolean;
    isSoloed: boolean;
    pluginChainIds: ReadonlyArray<PluginId>;
};

export const transformTrackToEngineConfig = (track: Track): TrackEngineConfig => ({
    id: track.id,
    gainLinear: track.isMuted ? (0 as LinearGain) : dbToLinear(track.gainDb),
    pan: track.pan,
    isMuted: track.isMuted,
    isSoloed: track.isSoloed,
    pluginChainIds: track.pluginChainIds,
});
```

### Presentations

**Hooks** connect use cases to React. They never import engine classes or AudioNodes directly.

```typescript
// src/modules/Arrangement/presentations/hooks/useMoveClip.ts

export const useMoveClip = () => {
    const { mutateAsync } = useMutation({
        mutationFn: (input: MoveClipInput) => {
            moveClip(input);
            return Promise.resolve();
        },
    });

    return { moveClip: mutateAsync };
};
```

**Real-time meters** bypass React entirely using `requestAnimationFrame` and canvas refs. They read from the `EngineTelemetryPort`, not from React state.

```typescript
// src/modules/Mixer/presentations/hooks/useMeterDisplay.ts

export const useMeterDisplay = (trackId: TrackId, canvasRef: RefObject<HTMLCanvasElement>) => {
    useEffect(() => {
        const enginePort = Container.getInstance().get<AudioEnginePort>('AudioEnginePort');
        const analyser = enginePort.getAnalyserNode(trackId);
        if (!analyser || !canvasRef.current) {
            return;
        }

        const data = new Float32Array(analyser.fftSize);
        let rafId: number;

        const draw = () => {
            analyser.getFloatTimeDomainData(data);
            const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
            drawMeter(canvasRef.current!, rms);
            rafId = requestAnimationFrame(draw);
        };

        rafId = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafId);
    }, [trackId]);
};
```

**Transport position display** uses the same imperative pattern — a DOM ref updated at 60fps, not React state.

```typescript
// src/modules/Transport/presentations/hooks/usePlaybackPosition.ts

export const usePlaybackPosition = (displayRef: RefObject<HTMLElement>) => {
    useEffect(() => {
        const enginePort = Container.getInstance().get<AudioEnginePort>('AudioEnginePort');
        let rafId: number;

        const update = () => {
            const positionSeconds = enginePort.getCurrentPosition();
            if (displayRef.current) {
                displayRef.current.textContent = formatTimecode(positionSeconds);
            }
            rafId = requestAnimationFrame(update);
        };

        rafId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(rafId);
    }, []);
};
```

---

## The engine anti-corruption layer

The boundary between the domain context (TypeScript, non-real-time) and the engine context (Web Audio API or Rust via Tauri IPC) is formalized as an **Anti-Corruption Layer (ACL)** with three distinct communication channels.

```
┌─────── DOMAIN CONTEXT (TypeScript, non-real-time) ───────┐
│  Use Cases → projectStore → Reconciliation Subscriptions  │
│                    ↓               ↓               ↓      │
│              Parameters      Topology        Transport     │
│              (fast path)     (slow path)     (slow path)   │
└──────────────── ACL BOUNDARY ────────────────────────────┘
                    ↓               ↓               ↓
┌─────── ENGINE CONTEXT (real-time safe) ──────────────────┐
│  AudioParam    Graph rebuild     Transport state          │
│  .setValueAt() via command queue  via command queue       │
│                                                           │
│         ↑ EngineTelemetry (feedback, display only)        │
│         meters, position, CPU load, underruns             │
└──────────────────────────────────────────────────────────┘
```

**Parameter updates (fast path):** When a fader moves, the use case updates the store and the reconciliation subscription writes directly to `AudioParam.setValueAtTime()` or `AudioParam.setTargetAtTime()`. This bypasses graph rebuilds entirely. These are the most frequent operations.

**Topology changes (slow path):** When tracks, plugins, or routing change, the reconciliation layer diffs old vs new state, builds a set of graph operations (add node, remove node, connect, disconnect), and applies them. In Web Audio, this means creating/disposing `AudioNode` instances. For Tauri/Rust, this sends a `GraphDescription` DTO via IPC.

**Engine → Domain feedback (telemetry):** Metering levels, playback position, CPU load, and buffer underrun counts flow back via a dedicated observable — NOT through the store or event system. React components subscribe to `EngineTelemetryPort` directly via `useRef` + `requestAnimationFrame`, never via state updates.

---

## Undo/redo via the Command domain

The `Command` domain uses **delta-based commands** — each command captures only the change, not full state snapshots. This scales to large projects with hundreds of tracks.

```typescript
// src/modules/Command/models/DeltaCommand.ts

export type DeltaCommand =
    | { type: 'ADD_TRACK'; payload: { track: Track } }
    | { type: 'REMOVE_TRACK'; payload: { track: Track } }
    | {
          type: 'MOVE_CLIP';
          payload: { clipId: ClipId; fromTrackId: TrackId; toTrackId: TrackId; fromStart: Beats; toStart: Beats };
      }
    | { type: 'SET_PARAM'; payload: { path: string; previousValue: number; newValue: number } }
    | { type: 'SET_TEMPO'; payload: { previousBpm: Bpm; newBpm: Bpm } }
    | { type: 'ADD_BREAKPOINT'; payload: { laneId: string; breakpoint: Breakpoint } }
    | { type: 'BATCH'; commands: DeltaCommand[] }; // Compound: undo replays in reverse
```

### Executing commands

```typescript
// src/modules/Command/useCases/executeCommand.ts

export const executeCommand = (command: DeltaCommand): void => {
    applyCommand(command); // Mutates projectStore with the delta
    undoStack.push(command);
    redoStack.clear();
};

export const undo = (): void => {
    const command = undoStack.pop();
    if (!command) {
        return;
    }
    reverseCommand(command); // Applies the inverse delta to projectStore
    redoStack.push(command);
};

export const redo = (): void => {
    const command = redoStack.pop();
    if (!command) {
        return;
    }
    applyCommand(command);
    undoStack.push(command);
};
```

### Coalescing continuous operations

A fader drag should produce one undo step, not 60. Use **coalesce groups** keyed by operation type:

```typescript
// src/modules/Command/useCases/coalescing.ts

let activeCoalesceKey: string | null = null;
let coalesceFirstCommand: DeltaCommand | null = null;

export const beginCoalesce = (key: string): void => {
    activeCoalesceKey = key;
    coalesceFirstCommand = null;
};

export const executeCoalescedCommand = (command: DeltaCommand): void => {
    if (!activeCoalesceKey) {
        executeCommand(command);
        return;
    }

    if (!coalesceFirstCommand) {
        // First command in the group — remember the "before" state
        coalesceFirstCommand = command;
        applyCommand(command); // Apply immediately for real-time feedback
    } else {
        // Subsequent commands — just apply, don't push to undo
        applyCommand(command);
    }
};

export const endCoalesce = (): void => {
    if (coalesceFirstCommand) {
        // Push one merged command: first command's "before" + latest state's "after"
        undoStack.push(coalesceFirstCommand);
        redoStack.clear();
    }
    activeCoalesceKey = null;
    coalesceFirstCommand = null;
};
```

Usage in a fader drag:

```typescript
// src/modules/Arrangement/presentations/hooks/useFaderDrag.ts

export const useFaderDrag = (trackId: TrackId) => {
    const startGainRef = useRef<Decibels>(0 as Decibels);

    const onDragStart = (gainDb: Decibels) => {
        startGainRef.current = gainDb;
        beginCoalesce(`arrangement.track.${trackId}.gain`);
    };

    const onDrag = (gainDb: Decibels) => {
        executeCoalescedCommand({
            type: 'SET_PARAM',
            payload: {
                path: `arrangement.track.${trackId}.gainDb`,
                previousValue: startGainRef.current,
                newValue: gainDb,
            },
        });
    };

    const onDragEnd = () => {
        endCoalesce();
    };

    return { onDragStart, onDrag, onDragEnd };
};
```

### Memory management

Limit undo history to **128–256 steps**. Drop oldest commands when the limit is reached. Set a configurable depth via project settings.

---

## Cross-domain interaction patterns

### Pattern A: Event-driven (async, no return value needed)

One domain emits, others subscribe. Neither side knows about the other.

```
Arrangement use case → emits TrackAddedEvent
  ↳ AudioEngine module: reconciles track into audio graph (via store subscription)
  ↳ Analytics module: logs track creation
  ↳ Command module: records to undo stack
```

### Pattern B: Direct use case import (sync, return value needed)

Allowed only between contract folders. Module B's use case calls Module A's use case.

```typescript
// Arrangement use case validating routing before removing a track
import { getRoutingForTrack } from '#/modules/Routing/useCases/getRoutingForTrack';

export const removeTrack = (trackId: TrackId): void => {
    const routing = getRoutingForTrack(trackId);
    if (routing.sends.length > 0) {
        // Cascade-delete sends first
        for (const send of routing.sends) {
            removeSend(send.id);
        }
    }
    // ... proceed with track removal
};
```

### Pattern C: Store selector (read-only, presentation layer)

Presentations read cross-domain state directly via the shared project store using `useSyncExternalStore`.

```typescript
// Mixer presentation reading track data from the Arrangement slice
const trackGainDb = useSyncExternalStore(
    (cb) => projectStore.subscribe(() => cb()),
    () => projectStore.value?.arrangement.tracks.find((t) => t.id === trackId)?.gainDb ?? (0 as Decibels),
    () => 0 as Decibels
);
```

### Pattern D: Tauri IPC (Rust services)

Adapters call Tauri commands for MIDI, file I/O, and plugin hosting. The result is transformed into domain types before reaching use cases.

```typescript
// Plugin domain adapter
export const createPluginTauriAdapter = (): PluginHostPort => ({
    loadPlugin: async (path: string) => {
        const raw = await invoke<RustPluginResponse>('load_plugin', { path });
        return transformRustPluginToInstance(raw);
    },
    // ...
});
```

---

## Domain event catalog

Every event extends `DomainEvent<TPayload>` and lives in the emitting domain's `events/` folder.

```typescript
// Arrangement
class TrackAddedEvent extends DomainEvent<{ trackId: TrackId; kind: TrackKind }> {}
class TrackRemovedEvent extends DomainEvent<{ trackId: TrackId; kind: TrackKind; name: string }> {}
class TrackMutedEvent extends DomainEvent<{ trackId: TrackId; isMuted: boolean }> {}
class TrackArmedEvent extends DomainEvent<{ trackId: TrackId; isArmed: boolean }> {}
class ClipAddedEvent extends DomainEvent<{ clipId: ClipId; trackId: TrackId; startBeats: Beats }> {}
class ClipMovedEvent extends DomainEvent<{
    clipId: ClipId;
    fromTrackId: TrackId;
    toTrackId: TrackId;
    newStartBeats: Beats;
}> {}
class ClipSplitEvent extends DomainEvent<{ originalId: ClipId; rightId: ClipId; splitPoint: Beats }> {}

// Transport
class TransportStartedEvent extends DomainEvent<{ positionBeats: Beats }> {}
class TransportStoppedEvent extends DomainEvent<{ positionBeats: Beats }> {}
class TempoChangedEvent extends DomainEvent<{ previousBpm: Bpm; newBpm: Bpm }> {}

// Routing
class RoutingChangedEvent extends DomainEvent<{ routing: RoutingState }> {}
class SendAddedEvent extends DomainEvent<{ sendId: string; sourceTrackId: TrackId; targetBusId: string }> {}

// Plugin
class PluginAddedEvent extends DomainEvent<{ pluginId: PluginId; trackId: TrackId }> {}
class PluginRemovedEvent extends DomainEvent<{ pluginId: PluginId; trackId: TrackId }> {}
class ParameterChangedEvent extends DomainEvent<{ pluginId: PluginId; paramId: string; value: number }> {}

// MIDI (from Rust via Tauri — re-emitted as DomainEvents by the adapter)
class NoteOnEvent extends DomainEvent<{ channel: number; note: MidiNote; velocity: MidiVelocity; deviceId: string }> {}
class NoteOffEvent extends DomainEvent<{ channel: number; note: MidiNote; deviceId: string }> {}
class MidiDeviceConnectedEvent extends DomainEvent<{ deviceId: string; name: string }> {}

// AudioEngine
class EngineStartedEvent extends DomainEvent<{ sampleRate: SampleRate }> {}
class EngineStoppedEvent extends DomainEvent<{}> {}

// Project
class ProjectLoadedEvent extends DomainEvent<{ projectId: string; name: string }> {}
class ProjectSavedEvent extends DomainEvent<{ projectId: string; path: string }> {}
```

---

## AudioContext lifecycle

The `AudioContext` requires a user gesture to start and must be managed carefully across the app lifecycle.

```typescript
// src/modules/AudioEngine/useCases/initializeEngine.ts

export const initializeEngine = async (): Promise<void> => {
    const enginePort = Container.getInstance().get<AudioEnginePort>('AudioEnginePort');
    await enginePort.initialize();
    engineStatusStore.set({ status: 'ready', sampleRate: enginePort.getSampleRate() });
    eventBus.emit(new EngineStartedEvent({ sampleRate: enginePort.getSampleRate() }));
};
```

---

## Shared types — the `shared/` layer

Many domains need the same identifiers and units. Place all cross-cutting primitives in `shared/` — not a domain, imported freely by any module.

```
src/
├── shared/
│   ├── types/
│   │   ├── ids.ts          # TrackId, ClipId, PluginId, ProjectId (branded types)
│   │   ├── time.ts         # Beats, Seconds, Samples, Bpm, SampleRate
│   │   ├── audio.ts        # Decibels, LinearGain, Pan (−1 to 1)
│   │   └── midi.ts         # MidiNote (0–127), MidiChannel (0–15), MidiVelocity
│   └── helpers/
│       └── conversions.ts  # dbToLinear, beatsToSeconds, samplesToSeconds
└── modules/
    └── ...
```

Branded types prevent accidental mixing of structurally identical values:

```typescript
// src/shared/types/ids.ts

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type TrackId = Brand<string, 'TrackId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type PluginId = Brand<string, 'PluginId'>;

export const toTrackId = (id: string): TrackId => id as TrackId;
export const toClipId = (id: string): ClipId => id as ClipId;

// src/shared/types/time.ts

export type Beats = Brand<number, 'Beats'>;
export type Seconds = Brand<number, 'Seconds'>;
export type Samples = Brand<number, 'Samples'>;
export type Bpm = Brand<number, 'Bpm'>;
export type SampleRate = Brand<number, 'SampleRate'>;

// src/shared/types/audio.ts

export type Decibels = Brand<number, 'Decibels'>;
export type LinearGain = Brand<number, 'LinearGain'>;
export type Pan = Brand<number, 'Pan'>;
```

**Rule:** `shared/` may only contain pure types and pure functions. It never imports from `modules/`.

---

## DTOs vs models

| Situation                                          | Use                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Module uses a type internally                      | **Internal model** — never exported cross-module                        |
| Module A's use case result is consumed by Module B | **DTO exported from `useCases/`** — the only cross-module type contract |
| Module A's event carries data that Module B needs  | **Event payload type exported from `events/`**                          |
| Two modules both need the same identifier or unit  | **Primitive from `shared/types/`**                                      |

```typescript
// src/modules/Arrangement/useCases/getTrackById.ts

// DTO — the contract exported to other modules
export type TrackDto = {
    id: TrackId;
    name: string;
    kind: TrackKind;
    isMuted: boolean;
    isArmed: boolean;
};

export type GetTrackByIdUseCase = (id: TrackId) => TrackDto;

export const getTrackById: GetTrackByIdUseCase = (id) => {
    const track = projectStore.value?.arrangement.tracks.find((t) => t.id === id);
    if (!track) {
        throw new TrackNotFoundError(id);
    }
    return {
        id: track.id,
        name: track.name,
        kind: track.kind,
        isMuted: track.isMuted,
        isArmed: track.isArmed,
    };
};
```

---

## Dependency rules

### What may be imported cross-module

| Folder                     | Cross-module importable? | Purpose                           |
| -------------------------- | ------------------------ | --------------------------------- |
| `useCases/`                | ✅ Yes — contract        | Business operations and DTOs      |
| `events/`                  | ✅ Yes — contract        | Domain events for subscription    |
| `errors/`                  | ✅ Yes — contract        | Error types for catch/handle      |
| `stores/` (business layer) | ✅ Yes — contract        | Shared state for reading          |
| `ports/`                   | ✅ Yes — contract        | Port interfaces for DI            |
| `presentations/views/`     | ✅ Yes — contract        | Composable view components        |
| `models/`                  | ❌ Private               | Internal domain types             |
| `validators/`              | ❌ Private               | Internal invariant enforcement    |
| `services/`                | ❌ Private               | Internal domain services          |
| `adapters/`                | ❌ Private               | Platform-specific implementations |
| `transformers/`            | ❌ Private               | Internal mapping logic            |
| `engine/`                  | ❌ Private               | Real-time engine internals        |
| `worklets/`                | ❌ Private               | Audio thread code                 |
| `presentations/hooks/`     | ❌ Private               | Module-specific hooks             |
| `presentations/stores/`    | ❌ Private               | UI preferences                    |
| `presentations/context/`   | ❌ Private               | Ephemeral UI state                |

```typescript
// ❌ Forbidden — importing a model from another module
import type { Track } from '#/modules/Arrangement/models/Track';

// ❌ Forbidden — importing a validator from another module
import { validateClipPlacement } from '#/modules/Arrangement/validators/validateClipPlacement';

// ❌ Forbidden — importing an adapter from another module
import { midiTauriAdapter } from '#/modules/MIDI/adapters/midiTauriAdapter';

// ❌ Forbidden — importing engine class from another domain
import { audioEngine } from '#/modules/AudioEngine/engine/AudioEngine';

// ✅ Allowed — importing a use case (contract folder)
import { moveClip } from '#/modules/Arrangement/useCases/moveClip';

// ✅ Allowed — importing a DTO type from a use case
import type { TrackDto } from '#/modules/Arrangement/useCases/getTrackById';

// ✅ Allowed — importing an event (contract folder)
import { TrackAddedEvent } from '#/modules/Arrangement/events/TrackAddedEvent';

// ✅ Allowed — importing a port interface (contract folder)
import type { AudioEnginePort } from '#/modules/AudioEngine/ports/AudioEnginePort';

// ✅ Allowed — importing a business-layer store
import { projectStore } from '#/modules/Project/stores/projectStore';

// ✅ Allowed — importing a view (contract folder)
import { ArrangementView } from '#/modules/Arrangement/presentations/views/ArrangementView';

// ✅ Allowed — importing a shared primitive
import type { TrackId } from '#/shared/types/ids';
```

### Enforcement

Use `eslint-plugin-boundaries` to codify these rules at lint time. Define element types by folder pattern and restrict imports between them. Add to CI so violations fail the build.

---

## Quick reference: which layer owns what

| Concern                            | Layer                                                                       | Example                                        |
| ---------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| Serializable project data          | `projectStore` in `Project/stores/` — **contract**                          | tracks, clips, BPM                             |
| Cross-module runtime state         | `Store<T>` in `stores/` at business layer — **contract**                    | MIDI device list, engine status                |
| Persistent UI state                | `Store<T>` + `LocalStorageStorage` in `presentations/stores/` — **private** | zoom level, sidebar open                       |
| Ephemeral UI state                 | React context inside `presentations/context/` — **private**                 | selected track, active tool                    |
| Local component state              | `useState`                                                                  | hover, input draft                             |
| AudioContext + nodes               | `engine/` class                                                             | `AudioEngine`, `TrackNode`                     |
| Aggregate invariants               | `validators/` pure functions                                                | clip overlap, routing cycles                   |
| Cross-entity domain logic          | `services/` pure functions                                                  | automation interpolation, latency compensation |
| I/O interface definition           | `ports/` interface                                                          | `AudioEnginePort`, `MidiDevicePort`            |
| I/O implementation                 | `adapters/`                                                                 | `WebAudioEngineAdapter`, `midiTauriAdapter`    |
| Subscribing to store outside React | `store.subscribe()`                                                         | engine reconciliation                          |
| Subscribing to store inside React  | `useSyncExternalStore`                                                      | hooks reading project state                    |
| Real-time display (60fps)          | `requestAnimationFrame` + canvas ref                                        | meters, playback position                      |
| Parameter during interaction       | `AudioParam` via reconciliation fast path                                   | fader drag                                     |
| Parameter at rest                  | `projectStore` + engine reconcile                                           | saved fader value                              |
| Tauri IPC                          | `adapters/`                                                                 | MIDI, file I/O, plugins                        |
| Cross-domain business logic        | `useCases/`                                                                 | add clip to armed track                        |
| Cross-domain notification          | `DomainEvent` + `eventBus`                                                  | tempo changed → MIDI clock                     |
| Shared identifiers and units       | `src/shared/types/`                                                         | `TrackId`, `Beats`, `Decibels`                 |
| Cross-module type contract         | DTO exported from `useCases/`                                               | `TrackDto`, `EngineStatusDto`                  |
| Reading another domain's state     | business layer store or DTO                                                 | mixer reading track names                      |
| Writing another domain's slice     | ❌ Never — call their use case                                              | `addTrack()` not `store.set()`                 |
| Shared engine concept (no owner)   | `AudioEngine/useCases/` DTO                                                 | `getEngineStatus()`                            |
| Undo/redo                          | `Command/` with delta commands + coalescing                                 | `executeCommand()`, `undo()`                   |
