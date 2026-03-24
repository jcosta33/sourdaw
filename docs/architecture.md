# DAW Architecture

This document defines the domain architecture for the DAW. It extends the base architecture guide with patterns specific to a real-time audio application: how classes are used for stateful engine objects, how the real-time boundary is respected, and how each layer is structured within every domain.

---

## Core principles (additions to the base guide)

The base architecture principles (UI → Business → IO, contract-based boundaries, framework-independent use cases) all apply. Three additional constraints govern every decision here:

**The real-time boundary is inviolable.** The Web Audio callback runs every ~5.8ms at 44.1kHz/256 samples. Nothing on that path may allocate memory, dispatch React state updates, or acquire locks. All state that the audio thread reads must be prepared on the main thread and handed off via lock-free primitives (`AudioParam`, `SharedArrayBuffer` + `Atomics`, or atomic ref swaps).

**Classes are appropriate for engine objects.** The base guide uses plain functions and module-level singletons. Engine objects — `AudioEngine`, `TrackNode`, `PluginNode` — are inherently stateful: they own `AudioNode` instances, manage lifecycle (connect/disconnect/dispose), and must reconcile diffs between old and new project state. Classes with explicit lifecycle (`initialize`, `dispose`) are the right tool for this. Use classes for anything that owns Web Audio resources.

**State has four tiers.** All state in the DAW falls into exactly one of:

| Tier                      | Where it lives                                         | Scope              | Examples                                     |
| ------------------------- | ------------------------------------------------------ | ------------------ | -------------------------------------------- |
| **Project state**         | `Store<T>` in `stores/` — contract                     | App-wide singleton | tracks, clips, BPM, plugin chains            |
| **Shared runtime state**  | `Store<T>` in `stores/` — contract                     | App-wide singleton | MIDI device list, engine ready status        |
| **Persistent UI state**   | `Store<T>` with `LocalStorageStorage` — module-private | Module             | user zoom preference, sidebar open           |
| **Ephemeral UI state**    | React context — module-private                         | Module subtree     | selected track, active tool, scroll position |
| **Local component state** | `useState`                                             | Component          | hover state, input draft value               |
| **Engine state**          | Class instances / `useRef`                             | Singleton          | AudioContext, AudioNodes                     |

Conflating these tiers is the primary source of bugs. Engine state is never in React state or a Store. Context is never shared across modules.

---

## Module structure

Each domain follows the base structure, extended with engine-specific layers:

```
AudioEngine/
├── _tests/
├── models/            # Domain types: AudioEngine, AudioGraph, AudioNode descriptors
├── errors/            # 🔗 CONTRACT: AudioEngineNotReadyError, AudioContextSuspendedError
├── events/            # 🔗 CONTRACT: EngineStartedEvent, EngineStoppedEvent
├── useCases/          # 🔗 CONTRACT: initializeEngine, startEngine, setMasterGain
├── stores/            # 🔗 CONTRACT: engineStatusStore (cross-module shared state)
├── repositories/      # Concrete engine construction: createWebAudioEngine
├── engine/            # Engine classes: AudioEngine, TrackNode, MixerNode (stateful)
├── worklets/          # AudioWorkletProcessor implementations (run in audio thread)
├── transformers/      # Map project state → engine config
└── presentations/
    ├── hooks/         # useAudioEngine, useMasterGain, useEngineStatus
    ├── stores/        # private: persistent UI preferences (LocalStorageStorage only)
    ├── context/       # private: ephemeral UI state (selection, active panel)
    └── views/         # 🔗 CONTRACT: views that compose engine hooks

Track/
├── models/            # Track, TrackKind, TrackInput
├── errors/            # 🔗 CONTRACT: TrackNotFoundError
├── events/            # 🔗 CONTRACT: TrackAddedEvent, TrackRemovedEvent, TrackMutedEvent
├── useCases/          # 🔗 CONTRACT: addTrack, removeTrack, muteTrack, renameTrack
├── stores/            # 🔗 CONTRACT: trackStore (cross-module shared state)
├── repositories/      # Track API calls (persist to project file)
├── transformers/      # transformTrack, transformTrackToEngineConfig
└── presentations/
    ├── hooks/         # useTracks, useAddTrack, useTrackControls
    ├── context/       # private: ephemeral UI state (selectedTrackId, activeTool)
    └── views/         # 🔗 CONTRACT: TrackListView, TrackHeaderView

Transport/
├── models/            # TransportState, TempoMap, TimeSignature, LoopRange
├── errors/            # 🔗 CONTRACT: InvalidTempoError
├── events/            # 🔗 CONTRACT: TransportStartedEvent, TempoChangedEvent
├── useCases/          # 🔗 CONTRACT: startTransport, stopTransport, setTempo, seekTo
├── stores/            # 🔗 CONTRACT: transportStore
├── repositories/      # transportEngineAdapter (bridge to AudioEngine)
└── presentations/
    ├── hooks/         # useTransportControls, usePlaybackPosition
    └── views/         # 🔗 CONTRACT: TransportBarView

Mixer/
├── models/            # MixerChannel, SendRoute, BusConfig
├── events/            # 🔗 CONTRACT: FaderMovedEvent, PanChangedEvent
├── useCases/          # 🔗 CONTRACT: setChannelGain, setPan, setSendLevel, addBus
├── repositories/      # mixerEngineAdapter
└── presentations/
    ├── hooks/         # useMixerChannel, useMasterOut, useMeters
    └── views/         # 🔗 CONTRACT: MixerConsoleView, ChannelStripView

Plugin/
├── models/            # PluginInstance, PluginParameter, PluginPreset
├── errors/            # 🔗 CONTRACT: PluginNotFoundError, PluginLoadError
├── events/            # 🔗 CONTRACT: PluginAddedEvent, ParameterChangedEvent
├── useCases/          # 🔗 CONTRACT: addPlugin, removePlugin, setParameter, loadPreset
├── repositories/      # pluginTauriAdapter (Tauri IPC bridge for native VST/AU)
└── presentations/
    ├── hooks/         # usePlugin, usePluginParameters
    └── views/         # 🔗 CONTRACT: PluginRackView, PluginEditorView

Clip/
├── models/            # Clip, ClipKind (audio|midi), FadeCurve, MidiNote
├── errors/            # 🔗 CONTRACT: ClipNotFoundError, ClipOverlapError
├── events/            # 🔗 CONTRACT: ClipAddedEvent, ClipMovedEvent, ClipSplitEvent
├── useCases/          # 🔗 CONTRACT: addClip, moveClip, resizeClip, splitClip
├── repositories/      # clipEngineAdapter, clipFileAdapter
└── presentations/
    ├── hooks/         # useClips, useMoveClip
    └── views/         # 🔗 CONTRACT: ArrangementView, ClipView

MIDI/
├── models/            # MidiEvent, MidiDevice, MidiRoute, MpeState
├── events/            # 🔗 CONTRACT: NoteOnEvent, NoteOffEvent, MidiDeviceConnectedEvent
├── useCases/          # 🔗 CONTRACT: connectMidiPort, sendMidiClock, routeMidiInput
├── repositories/      # midiTauriAdapter (Tauri IPC bridge — midir in Rust)
└── presentations/
    ├── hooks/         # useMidiDevices, useMidiInput
    └── views/         # 🔗 CONTRACT: MidiRoutingView

Project/
├── models/            # Project, ProjectMeta, ProjectSnapshot
├── errors/            # 🔗 CONTRACT: ProjectLoadError, ProjectSaveError
├── events/            # 🔗 CONTRACT: ProjectLoadedEvent, ProjectSavedEvent
├── useCases/          # 🔗 CONTRACT: loadProject, saveProject, newProject
├── repositories/      # projectFileAdapter (Tauri fs plugin)
├── transformers/      # serializeProject, deserializeProject
└── presentations/
    ├── hooks/         # useProjectMeta, useRecentProjects
    └── views/         # 🔗 CONTRACT: ProjectSettingsView

Automation/
├── models/            # AutomationLane, BreakpointList, AutomationTarget
├── events/            # 🔗 CONTRACT: AutomationPointAddedEvent, AutomationModeChangedEvent
├── useCases/          # 🔗 CONTRACT: addBreakpoint, setAutomationMode, deleteBreakpoint
├── repositories/      # automationEngineAdapter
└── presentations/
    ├── hooks/         # useAutomationLane, useAutomationMode
    └── views/         # 🔗 CONTRACT: AutomationLaneView

Command/                # Cross-cutting: undo/redo, keyboard shortcut dispatch
├── models/            # AppCommand union type, UndoStack
├── useCases/          # 🔗 CONTRACT: executeCommand, undo, redo
└── presentations/
    └── hooks/         # useUndo, useCommandHistory
```

---

## State ownership in detail

### Project state — the Vanilla Store

The project store is the single source of truth for everything that gets serialized. It is a **pure data model** — no AudioNode references, no class instances, no functions.

```typescript
// src/modules/Project/stores/projectStore.ts

import { Store } from '#/helpers/Store/Store';

// The complete serializable project state
export type ProjectState = {
    meta: ProjectMeta;
    tracks: ReadonlyArray<Track>;
    clips: ReadonlyArray<Clip>;
    transport: TransportConfig; // BPM, time signature, loop range
    mixer: MixerState; // fader, pan, send levels per track
    plugins: ReadonlyArray<PluginInstance>;
    automation: ReadonlyArray<AutomationLane>;
};

export const projectStore = new Store<ProjectState>(defaultProjectState);

// Engine reconciliation subscribes to specific slices
// This is the key pattern: engine reacts to state changes without re-renders
useProjectStore.subscribe(
    (state) => state.transport,
    (transport) => audioEngine.reconcileTransport(transport)
);

useProjectStore.subscribe(
    (state) => state.tracks,
    (tracks, prevTracks) => audioEngine.reconcileTracks(tracks, prevTracks)
);
```

`subscribeWithSelector` is essential — it lets the audio engine subscribe to specific slices of state without reacting to unrelated changes.

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

    // Called by store subscription when tracks change
    reconcileTracks(next: ReadonlyArray<Track>, prev: ReadonlyArray<Track>): void {
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

    // Parameter changes: bypass React entirely, update AudioParam directly
    setTrackGain(trackId: string, gain: number): void {
        const node = this.trackNodes.get(trackId);
        if (!node) throw new AudioEngineNotReadyError(trackId);
        node.gainNode.gain.setTargetAtTime(gain, this.context.currentTime, 0.01);
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
  if (!ctx) throw new Error('useArrangementContext must be used within ArrangementProvider');
  return ctx;
};
```

**Persistent UI state** (zoom level, sidebar open, panel layout — anything that should survive a refresh) lives in a `Store<T>` with `LocalStorageStorage` inside `presentations/stores/`. This is the only acceptable use of a store inside `presentations/`. It is still module-private — never imported by another module.

```typescript
// src/modules/Arrangement/presentations/stores/arrangementPreferencesStore.ts

export const arrangementPreferencesStore = new Store<ArrangementPreferences>(Container.getInstance().get(Logger), {
    storage: new LocalStorageStorage('arrangement-preferences'),
    initialData: {
        zoomLevel: 100, // pixels per beat
        snapToGrid: true,
    },
});
```

---

## Layer implementation: DAW-specific patterns

### Models

Models are plain TypeScript types. They describe shapes, not behavior. Engine resources are never in models.

```typescript
// src/modules/Arrangement/models/Track.ts

export type TrackKind = 'audio' | 'midi' | 'instrument' | 'bus' | 'master';

export type Track = {
    id: string;
    name: string;
    kind: TrackKind;
    color: string;
    isMuted: boolean;
    isSoloed: boolean;
    isArmed: boolean;
    gainDb: number;
    pan: number; // -1 to 1
    inputSource: string | null;
    pluginChain: ReadonlyArray<string>; // plugin instance IDs, ordered
};

// src/modules/Transport/models/TransportConfig.ts

export type TransportConfig = {
    bpm: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    loopEnabled: boolean;
    loopStartBeats: number;
    loopEndBeats: number;
};
```

### Repositories — two kinds

DAW repositories fall into two patterns. **Each repository file exports exactly one function.** Repositories are thin adapters — they translate domain calls into I/O calls. They do NOT contain business logic, validation, or orchestration.

Repositories are the only place where bare-metal I/O happens: DOM/Canvas APIs, Web Audio API, localStorage, IndexedDB, fetch, Tauri invoke, etc. If a use case does raw I/O, that code belongs in a repository.

```typescript
// src/modules/Mixer/repositories/mixerEngineAdapter.ts

// The adapter knows about the audioEngine singleton and translates
// domain calls into engine calls. Use cases import this, not audioEngine directly.

export const setChannelGainInEngine = (trackId: string, gainDb: number): void => {
    const gain = dbToLinear(gainDb);
    audioEngine.setTrackGain(trackId, gain);
};

export const setChannelPanInEngine = (trackId: string, pan: number): void => {
    audioEngine.setTrackPan(trackId, pan);
};
```

**Tauri adapter repositories** wrap `invoke` and Tauri event listeners for Rust-backed features.

```typescript
// src/modules/MIDI/repositories/midiTauriAdapter.ts

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { MidiDevice, MidiEvent } from '../models/MidiEvent';

export const listMidiPorts = (): Promise<MidiDevice[]> => {
    return invoke('list_midi_ports');
};

export const connectMidiPort = (portIndex: number): Promise<void> => {
    return invoke('connect_midi_port', { portIndex });
};

export const onMidiMessage = (handler: (event: MidiEvent) => void): Promise<() => void> => {
    return listen<MidiEvent>('midi-message', (e) => handler(e.payload));
};
```

### Use cases

Use cases contain business logic only. They may call repositories (including engine adapters) but never import engine classes directly. They always dispatch domain events after mutating state. **Each use case file exports exactly one function.**

Use cases **never** do I/O directly. If a use case needs to access localStorage, fetch data, call the audio engine, or invoke a Tauri command, that I/O belongs in a repository. Use cases only orchestrate repositories.

```typescript
// src/modules/Transport/useCases/setTempo.ts

import { inject } from '#/helpers/DependencyInjector/inject';
import { transportEngineAdapter } from '../repositories/transportEngineAdapter';
import { eventBus } from '#/app/eventBus';
import { TempoChangedEvent } from '../events/TempoChangedEvent';
import { InvalidTempoError } from '../errors/InvalidTempoError';
import { useProjectStore } from '#/modules/Project/stores/projectStore';

export const setTempo = inject(
    { transportEngineAdapter },
    ({ transportEngineAdapter }) =>
        async (bpm: number): Promise<void> => {
            if (bpm < 20 || bpm > 300) {
                throw new InvalidTempoError(bpm);
            }

            // 1. Update project state (serializable, triggers engine reconciliation via subscription)
            const prev = projectStore.value?.transport.bpm ?? 120;
            projectStore.set({
                ...projectStore.value!,
                transport: { ...projectStore.value!.transport, bpm },
            });

            // 2. Apply to engine immediately for zero-latency response
            transportEngineAdapter.setTempo(bpm);

            // 3. Emit event for other domains (Analytics, MIDI clock, etc.)
            eventBus.emit(new TempoChangedEvent({ previousBpm: prev, newBpm: bpm }));
        }
);
```

### The reconciliation pattern for undo/redo

When a user performs undo, the project store is restored to its previous snapshot. The engine must catch up. This works automatically because the engine subscribes to store slices.

```typescript
// src/modules/Command/useCases/undo.ts

export const undo = (): void => {
    const snapshot = undoStack.pop();
    if (!snapshot) return;

    // Restore entire project state — engine subscriptions fire automatically
    useProjectStore.setState(snapshot);
};
```

This is the key architectural insight: **undo/redo is free** because the engine reconciles to whatever state the store contains.

### Transformers

Transformers map between domain models and engine configuration. They are pure functions with no side effects.

```typescript
// src/modules/Arrangement/transformers/transformTrackToEngineConfig.ts

export type TrackEngineConfig = {
    id: string;
    gainLinear: number;
    pan: number;
    isMuted: boolean;
    isSoloed: boolean;
    pluginChain: ReadonlyArray<string>;
};

export const transformTrackToEngineConfig = (track: Track): TrackEngineConfig => ({
    id: track.id,
    gainLinear: isMuted ? 0 : dbToLinear(track.gainDb),
    pan: track.pan,
    isMuted: track.isMuted,
    isSoloed: track.isSoloed,
    pluginChain: track.pluginChain,
});
```

### Presentations

**Hooks** connect use cases to React. They never import engine classes or AudioNodes directly.

```typescript
// src/modules/Mixer/presentations/hooks/useMixerChannel.ts

export const useMixerChannel = (trackId: string) => {
    const channel = useProjectStore((s) => s.tracks.find((t) => t.id === trackId));

    const { mutateAsync: setGain } = useMutation({
        // During drag: set AudioParam directly (zero latency, no re-render)
        mutationFn: (gainDb: number) => setChannelGain(trackId, gainDb),
    });

    return { channel, setGain };
};
```

**Real-time meters** bypass React entirely using `requestAnimationFrame` and canvas refs.

```typescript
// src/modules/Mixer/presentations/hooks/useMeterDisplay.ts

export const useMeterDisplay = (trackId: string, canvasRef: RefObject<HTMLCanvasElement>) => {
    useEffect(() => {
        const analyser = audioEngine.getAnalyserNode(trackId);
        if (!analyser || !canvasRef.current) return;

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

**Transport position display** uses the same pattern — an imperative DOM ref updated at 60fps, not React state.

```typescript
// src/modules/Transport/presentations/hooks/usePlaybackPosition.ts

export const usePlaybackPosition = (displayRef: RefObject<HTMLElement>) => {
    useEffect(() => {
        let rafId: number;

        const update = () => {
            const positionSeconds = audioEngine.getCurrentPosition();
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

## Cross-domain interaction patterns

### Pattern A: Event-driven (async, no return value needed)

One domain emits, others subscribe. Neither side knows about the other.

```
Track use case → emits TrackAddedEvent
  ↳ AudioEngine module: reconciles track into audio graph
  ↳ Analytics module: logs track creation
  ↳ Command module: records to undo stack
```

### Pattern B: Direct use case import (sync, return value needed)

Allowed only between contract folders. Module B's use case calls Module A's use case.

```typescript
// Clip use case validating track existence before adding clip
import { getTrackById } from '#/modules/Arrangement/useCases/getTrackById';

export const addClip = async (input: AddClipInput): Promise<Clip> => {
    const track = await getTrackById(input.trackId); // cross-module, allowed
    if (!track.isArmed && input.isRecording) throw new TrackNotArmedError(input.trackId);
    // ...
};
```

### Pattern C: Store selector (read-only, presentation layer)

Presentations read cross-domain state directly via the shared project store using `useSyncExternalStore`.

```typescript
// Transport bar showing track count (Transport domain reading Track domain state)
const trackCount = useSyncExternalStore(
    projectStore.subscribe,
    () => projectStore.value.tracks.length
);
```

### Pattern D: Tauri IPC (Rust services)

Repositories call Tauri commands for MIDI, file I/O, and plugin hosting. The result is transformed into domain types before reaching use cases.

```typescript
// Plugin domain repository
export const loadPluginFromRust = async (path: string): Promise<PluginInstance> => {
    const raw = await invoke<RustPluginResponse>('load_plugin', { path });
    return transformRustPluginToInstance(raw);
};
```

---

## Domain event catalog

Every event extends `DomainEvent<TPayload>` and lives in the emitting domain's `events/` folder.

```typescript
// Transport
class TransportStartedEvent extends DomainEvent<{ positionBeats: number }> {}
class TransportStoppedEvent extends DomainEvent<{ positionBeats: number }> {}
class TempoChangedEvent extends DomainEvent<{ previousBpm: number; newBpm: number }> {}
class LoopRangeChangedEvent extends DomainEvent<{ startBeats: number; endBeats: number }> {}

// Track
class TrackAddedEvent extends DomainEvent<{ trackId: string; kind: TrackKind }> {}
class TrackRemovedEvent extends DomainEvent<{ trackId: string; kind: TrackKind; name: string }> {}
class TrackMutedEvent extends DomainEvent<{ trackId: string; isMuted: boolean }> {}
class TrackArmedEvent extends DomainEvent<{ trackId: string; isArmed: boolean }> {}

// Clip
class ClipAddedEvent extends DomainEvent<{ clipId: string; trackId: string; startBeats: number }> {}
class ClipMovedEvent extends DomainEvent<{ clipId: string; fromTrack: string; toTrack: string; startBeats: number }> {}
class ClipSplitEvent extends DomainEvent<{ originalId: string; rightId: string; splitPoint: number }> {}

// Plugin
class PluginAddedEvent extends DomainEvent<{ pluginId: string; trackId: string }> {}
class PluginRemovedEvent extends DomainEvent<{ pluginId: string; trackId: string }> {}
class ParameterChangedEvent extends DomainEvent<{ pluginId: string; paramId: string; value: number }> {}

// MIDI (from Rust via Tauri — re-emitted as DomainEvents)
class NoteOnEvent extends DomainEvent<{ channel: number; note: number; velocity: number; deviceId: string }> {}
class NoteOffEvent extends DomainEvent<{ channel: number; note: number; deviceId: string }> {}
class MidiDeviceConnectedEvent extends DomainEvent<{ deviceId: string; name: string }> {}

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
    // Must be called from a user interaction handler (click, keydown, etc.)
    await audioEngine.initialize();
    engineStatusStore.set({ status: 'ready', sampleRate: audioEngine.sampleRate });
    eventBus.emit(new EngineStartedEvent({ sampleRate: audioEngine.sampleRate }));
};

// src/modules/AudioEngine/presentations/hooks/useEngineInit.ts
// Called once from the root layout on first meaningful user interaction

export const useEngineInit = () => {
    const status = useSyncExternalStore(
        (onChange) => engineStatusStore.subscribe(() => onChange()),
        () => engineStatusStore.value?.status ?? 'uninitialized',
        () => 'uninitialized'
    );

    const initialize = () => {
        if (status !== 'uninitialized') return;
        initializeEngine().catch(console.error);
    };

    return { status, initialize };
};
```

---

## Undo/redo via the Command domain

The `Command` domain owns the undo stack. Every mutating use case goes through it.

```typescript
// src/modules/Command/models/AppCommand.ts

// Each command captures the before/after state delta
export type AppCommand =
    | { type: 'ADD_TRACK'; payload: Track }
    | { type: 'REMOVE_TRACK'; payload: { trackId: string; snapshot: Track } }
    | { type: 'MOVE_CLIP'; payload: { clipId: string; from: ClipPosition; to: ClipPosition } }
    | { type: 'SET_TEMPO'; payload: { previousBpm: number; newBpm: number } }
    | { type: 'COMPOUND'; commands: AppCommand[] }; // for multi-step operations

// src/modules/Command/useCases/executeCommand.ts

export const executeCommand = (command: AppCommand): void => {
    applyCommand(command); // mutates projectStore
    undoStack.push(command);
    redoStack.clear(); // new action clears redo history
};

export const undo = (): void => {
    const command = undoStack.pop();
    if (!command) return;
    reverseCommand(command); // restores projectStore slice
    redoStack.push(command);
};
```

Continuous operations (fader drag, clip resize) use **coalescing**: the command is not committed until the gesture ends.

```typescript
// src/modules/Mixer/presentations/hooks/useFaderDrag.ts

export const useFaderDrag = (trackId: string) => {
    const isDragging = useRef(false);
    const startGain = useRef(0);

    const onDragStart = (gainDb: number) => {
        isDragging.current = true;
        startGain.current = gainDb;
    };

    const onDrag = (gainDb: number) => {
        // Direct engine update — no store mutation, no re-render during drag
        audioEngine.setTrackGain(trackId, dbToLinear(gainDb));
    };

    const onDragEnd = (gainDb: number) => {
        isDragging.current = false;
        // Now commit to store and undo stack as a single action
        executeCommand({
            type: 'SET_CHANNEL_GAIN',
            payload: { trackId, previousGainDb: startGain.current, gainDb },
        });
    };

    return { onDragStart, onDrag, onDragEnd };
};
```

---

## Dependency rules (additions to base guide)

### Business-layer stores are contracts — presentation-layer stores are private

This distinction is critical and must be stated explicitly.

**A module's `stores/` folder (at the business layer, e.g. `Track/stores/`) is a cross-module contract.** These stores hold project state, shared runtime state, and cross-cutting data (tracks, transport config, engine status, MIDI device list). Any module may import them — both for reading via `useSyncExternalStore` and for writing from use cases.

**A module's `presentations/stores/` folder is private to that module.** These stores hold UI preferences (zoom level, sidebar state, panel layout) that only the owning module's presentation layer needs. They are never imported cross-module.

**A module's `models/` folder is never imported by another module.** Models are internal implementation details. If another module needs a type from your domain, you export a **DTO from `useCases/`** — not the model itself.

```typescript
// ❌ Forbidden — importing a model from another module
import type { Track } from '#/modules/Arrangement/models/Track';

// ❌ Forbidden — importing a presentation-layer store from another module
import { trackSelectionStore } from '#/modules/Arrangement/presentations/stores/trackSelectionStore';

// ❌ Forbidden — importing a transformer from another module
import { transformTrack } from '#/modules/Arrangement/transformers/transformTrack';

// ❌ Forbidden — importing a repository from another module
import { getTrackByIdApi } from '#/modules/Arrangement/repositories/getTrackByIdApi';

// ❌ Forbidden — importing a hook from another module
import { useTrackControls } from '#/modules/Arrangement/presentations/hooks/useTrackControls';

// ✅ Allowed — importing a business-layer store (contract folder)
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

// ✅ Allowed — importing a DTO type exported from a use case (contract folder)
import type { TrackDto } from '#/modules/Arrangement/useCases/getTrackById';

// ✅ Allowed — calling a use case (contract folder)
import { getTrackById } from '#/modules/Arrangement/useCases/getTrackById';

// ✅ Allowed — importing an error (contract folder)
import { TrackNotFoundError } from '#/modules/Arrangement/errors/TrackNotFoundError';

// ✅ Allowed — importing an event (contract folder)
import { TrackAddedEvent } from '#/modules/Arrangement/events/TrackAddedEvent';

// ✅ Allowed — importing a view (contract folder)
import { TrackListView } from '#/modules/Arrangement/presentations/views/TrackListView';

// ✅ Allowed — importing a shared primitive (not a module boundary at all)
import type { TrackId } from '#/shared/types/ids';
```

The folders that may be imported by other modules are: `useCases/`, `events/`, `errors/`, `stores/`, `presentations/views/`. Every other folder is private.

---

### Engine objects

`engine/` folders are **internal** to their domain. No other domain imports from `AudioEngine/engine/` directly. All cross-domain engine access goes through `useCases/` contracts.

```typescript
// ❌ Forbidden — importing engine class from another domain
import { audioEngine } from '#/modules/AudioEngine/engine/AudioEngine';

// ✅ Allowed — calling a use case that delegates to the engine
import { setMasterGain } from '#/modules/AudioEngine/useCases/setMasterGain';
```

### Real-time code

AudioWorklet processors in `worklets/` are isolated modules. They communicate with the main thread only via `MessagePort` or `SharedArrayBuffer + Atomics`. They never import from `useCases/` or `repositories/`.

### Tauri adapters

Tauri IPC (`invoke`, `listen`) is isolated to `repositories/`. Use cases never call `invoke` directly.

```typescript
// ❌ Forbidden
import { invoke } from '@tauri-apps/api/core';
export const loadPlugin = () => invoke('load_plugin', ...);

// ✅ Correct — invoke only in repository
export const loadPlugin = inject(
  { pluginTauriAdapter },
  ({ pluginTauriAdapter }) => (path: string) => pluginTauriAdapter.loadPlugin(path),
);
```

---

## Cross-module sharing

### 1. Shared primitive types — the `shared/` layer

Many domains need the same identifiers and units. Rather than having `Track` own `TrackId` and forcing every other domain to import from `Track/models/`, place all cross-cutting primitives in a dedicated `shared/` folder outside `modules/`. This is not a domain — it has no use cases, no events, no repositories. It is imported by any module that needs it.

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

// Cast at the boundary where IDs originate (repositories, factories)
export const toTrackId = (id: string): TrackId => id as TrackId;
export const toClipId = (id: string): ClipId => id as ClipId;
export const toPluginId = (id: string): PluginId => id as PluginId;

// src/shared/types/time.ts

export type Beats = Brand<number, 'Beats'>;
export type Seconds = Brand<number, 'Seconds'>;
export type Samples = Brand<number, 'Samples'>;
export type Bpm = Brand<number, 'Bpm'>;

export const toBeats = (n: number): Beats => n as Beats;
export const toSeconds = (n: number): Seconds => n as Seconds;

// src/shared/types/audio.ts

export type Decibels = Brand<number, 'Decibels'>;
export type LinearGain = Brand<number, 'LinearGain'>;
export type Pan = Brand<number, 'Pan'>; // −1 to 1

// src/shared/helpers/conversions.ts

import type { Decibels, LinearGain } from '../types/audio';

export const dbToLinear = (db: Decibels): LinearGain => Math.pow(10, db / 20) as LinearGain;

export const linearToDb = (linear: LinearGain): Decibels => (20 * Math.log10(linear)) as Decibels;
```

**Rule:** `shared/` may only contain pure types and pure functions. It never imports from `modules/`. Modules import from `shared/` freely — it is not a domain boundary violation.

---

### 2. DTOs vs models — the distinction and when it matters

The distinction tracks the direction of the cross-module dependency:

| Situation                                                                    | Use                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Module uses a type internally (own models, own use cases, own presentations) | **Internal model** — never exported across modules                                    |
| Module A's use case result is consumed by Module B's use case or transformer | **DTO exported from `useCases/`** — the only cross-module type contract               |
| Module A's event carries data that Module B needs                            | **Event payload type exported from `events/`** — consumed via `DomainEvent<TPayload>` |
| Two modules both need the same identifier or unit                            | **Primitive from `shared/types/`**                                                    |

A model stays internal to its module. A DTO is what that module chooses to expose — a deliberate, minimal, stable subset. The DTO lives in the `useCases/` file that produces it, so consuming modules import from a contract folder:

```typescript
// src/modules/Arrangement/useCases/getTrackById.ts

// Internal model — Track lives in Track/models/ and never crosses the boundary
import type { Track } from '../models/Track';
import type { TrackId } from '#/shared/types/ids';

// DTO — the contract exported to other modules
export type TrackDto = {
    id: TrackId;
    name: string;
    kind: TrackKind;
    isMuted: boolean;
    isArmed: boolean;
};

export type GetTrackByIdUseCase = (id: TrackId) => Promise<TrackDto>;

export const getTrackById: GetTrackByIdUseCase = async (id) => {
    const track = await trackRepository.findById(id);
    if (!track) throw new TrackNotFoundError(id);
    // Map internal model → DTO before returning
    return {
        id: track.id,
        name: track.name,
        kind: track.kind,
        isMuted: track.isMuted,
        isArmed: track.isArmed,
        // gainDb, pluginChain, etc. are intentionally excluded — not this caller's concern
    };
};
```

The consuming module maps the DTO to its own local type immediately:

```typescript
// src/modules/Arrangement/transformers/transformTrackToClipContext.ts

import type { TrackDto } from '#/modules/Arrangement/useCases/getTrackById';

// Clip domain's local representation of what it needs from a track
type ClipTrackContext = {
    trackId: TrackId;
    isArmed: boolean;
};

export const transformTrackToClipContext = (dto: TrackDto): ClipTrackContext => ({
    trackId: dto.id,
    isArmed: dto.isArmed,
});
```

**The rule:** if you find yourself needing more fields than the DTO exposes, either expand the DTO (a deliberate contract change) or reconsider whether the consuming domain is reaching too far into another domain's concerns.

---

### 3. Business layer stores — shared contract, not a violation

Business layer stores (`Store<T>` files that live outside `presentations/`) are deliberately cross-cutting. Any module may import and read them. They are contract surfaces, the same as `useCases/` or `events/`.

The rules that still apply:

**Modules write to the store only through their own use cases.** No presentation layer and no cross-module use case writes to a shared store directly — they call the owning domain's use case, which performs the write.

```typescript
// ❌ Forbidden — Clip presentation writing to projectStore directly
projectStore.set({ ...projectStore.value!, tracks: [...tracks, newTrack] });

// ✅ Correct — calling the Track use case, which owns the write
await addTrack({ name: 'New Track', kind: 'audio' });
// addTrack internally calls projectStore.set(...)
```

**Modules read from the store freely.**

```typescript
// ✅ Fine — any hook reading from a business layer store
const tracks = useSyncExternalStore(
    (cb) => projectStore.subscribe(() => cb()),
    () => projectStore.value?.tracks ?? [],
    () => []
);

// ✅ Fine — engine subscribing outside React
projectStore.subscribe((state) => {
    if (state) audioEngine.reconcileTracks(state.tracks);
});
```

**Modules own their slice.** Each domain's use cases only write to the slice that belongs to them. No module writes to another module's slice.

```typescript
// ❌ Forbidden — Transport writing to the tracks slice
projectStore.set({ ...projectStore.value!, tracks: projectStore.value!.tracks.map(muteAll) });

// ✅ Correct — Transport only touches its own slice
projectStore.set({ ...projectStore.value!, transport: { ...projectStore.value!.transport, bpm } });
```

The ownership map for `projectStore`:

| Store slice        | Owning domain | Who may write             |
| ------------------ | ------------- | ------------------------- |
| `state.transport`  | Transport     | Transport use cases only  |
| `state.tracks`     | Track         | Track use cases only      |
| `state.clips`      | Clip          | Clip use cases only       |
| `state.mixer`      | Mixer         | Mixer use cases only      |
| `state.plugins`    | Plugin        | Plugin use cases only     |
| `state.automation` | Automation    | Automation use cases only |
| `state.meta`       | Project       | Project use cases only    |

---

### 4. Shared engine state — the ownership rule

When multiple domains need the same engine state, the question is always: **which domain is responsible for that audio concept?**

Track gain is a good example. Both `Track` (because it's a track property) and `Mixer` (because the mixer controls it) seem like reasonable owners. The resolution is that **the concept lives where it semantically belongs** and is exposed through that domain's use case contract.

Track gain belongs to `Mixer` because gain is a mixing decision, not a track identity. The `Track` model carries `gainDb` as a persisted value for serialization, but the engine operation lives in `Mixer`.

```typescript
// Mixer owns the engine adapter for gain
// src/modules/Mixer/repositories/mixerEngineAdapter.ts

export const setChannelGainInEngine = (trackId: TrackId, gainDb: Decibels): void => {
    audioEngine.setTrackGain(trackId, dbToLinear(gainDb));
};

// Mixer owns the use case
// src/modules/Mixer/useCases/setChannelGain.ts

export const setChannelGain = (trackId: TrackId, gainDb: Decibels): void => {
    setChannelGainInEngine(trackId, gainDb);
    const state = projectStore.value!;
    projectStore.set({
        ...state,
        mixer: {
            ...state.mixer,
            channels: state.mixer.channels.map((c) => (c.trackId === trackId ? { ...c, gainDb } : c)),
        },
    });
};
```

If `Track` presentations need to display gain (e.g. in a compact track header), they read from the store — not from Mixer's use cases:

```typescript
// Track presentation reading gain from the shared store — fine
const gainDb = useSyncExternalStore(
    (cb) => projectStore.subscribe(() => cb()),
    () => projectStore.value?.mixer.channels.find((c) => c.trackId === trackId)?.gainDb ?? 0,
    () => 0
);
```

For engine state that has no natural domain home (e.g. the `AudioContext` sample rate, which many domains might want), expose it through `AudioEngine`'s use case contract:

```typescript
// src/modules/AudioEngine/useCases/getEngineStatus.ts

export type EngineStatusDto = {
    isReady: boolean;
    sampleRate: number;
    baseLatencySeconds: number;
};

export const getEngineStatus = (): EngineStatusDto => ({
    isReady: audioEngine.context?.state === 'running',
    sampleRate: audioEngine.context?.sampleRate ?? 44100,
    baseLatencySeconds: audioEngine.context?.baseLatency ?? 0,
});
```

Other domains call `getEngineStatus()` from `AudioEngine/useCases/` — never reaching into `AudioEngine/engine/` directly.

**Decision tree for shared engine state:**

```
Does the concept have a clear audio/domain home?
├── Yes → Put the engine adapter in that domain's repositories/,
│         the use case in that domain's useCases/,
│         and expose a DTO for anyone who needs to read it.
└── No (truly cross-cutting, e.g. AudioContext lifecycle) →
    Put it in AudioEngine/useCases/ as the canonical source.
    Other domains import from AudioEngine/useCases/, never AudioEngine/engine/.
```

---

## Quick reference: which layer owns what

| Concern                                | Layer                                                                       | Example                         |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| Serializable project data              | `projectStore` in `Project/stores/` — **contract**                          | tracks, clips, BPM              |
| Cross-module runtime state             | `Store<T>` in `stores/` at business layer — **contract**                    | MIDI device list, engine status |
| Persistent UI state                    | `Store<T>` + `LocalStorageStorage` in `presentations/stores/` — **private** | zoom level, sidebar open        |
| Ephemeral UI state                     | React context inside `presentations/context/` — **private**                 | selected track, active tool     |
| Local component state                  | `useState`                                                                  | hover, input draft              |
| AudioContext + nodes                   | `engine/` class                                                             | `AudioEngine`, `TrackNode`      |
| Subscribing to a store outside React   | `store.subscribe()`                                                         | engine reconciliation           |
| Subscribing to a store inside React    | `useSyncExternalStore`                                                      | hooks reading project state     |
| Real-time display (60fps)              | `requestAnimationFrame` + canvas ref                                        | meters, position                |
| Parameter during interaction           | `AudioParam` direct set                                                     | fader drag                      |
| Parameter at rest                      | `projectStore` + engine reconcile                                           | saved fader value               |
| Tauri IPC                              | `repositories/` adapter                                                     | MIDI, file I/O, plugins         |
| Cross-domain business logic            | `useCases/`                                                                 | add clip to armed track         |
| Cross-domain notification              | `DomainEvent` + `eventBus`                                                  | tempo changed → MIDI clock      |
| Shared identifiers and units           | `src/shared/types/`                                                         | `TrackId`, `Beats`, `Decibels`  |
| Cross-module type contract             | DTO exported from `useCases/`                                               | `TrackDto`, `EngineStatusDto`   |
| Reading another domain's state         | business layer store or DTO                                                 | mixer reading track names       |
| Writing another domain's slice         | ❌ Never — call their use case                                              | `addTrack()` not `store.set()`  |
| Shared engine concept (no clear owner) | `AudioEngine/useCases/` DTO                                                 | `getEngineStatus()`             |
