import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';
import { workspaceStore } from '#/modules/Workspace/stores';

export type ProjectContextClip = {
    id: string;
    name: string;
    type: 'audio' | 'midi';
    startBeat: number;
    endBeat: number;
    noteCount: number;
};

export type ProjectContextDevice = {
    id: string;
    type: string;
    bypassed: boolean;
};

export type ProjectContextTrack = {
    id: string;
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    clipCount: number;
    deviceCount: number;
    clips: ProjectContextClip[];
    devices: ProjectContextDevice[];
};

export type ProjectContext = {
    tempo: number;
    timeSignature: [number, number];
    tracks: ProjectContextTrack[];
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    activeView: 'arrange' | 'automation' | 'clip' | 'mix';
    playheadPosition: number;
};

// §92.2 — Memoize the context by the identity of the four backing store
// values. Stores use immutable replacement (.set(new object)), so
// reference equality is enough: if all four have the same identity as
// the last call, we can return the cached context without rebuilding
// the entire track/clip/device graph for the AI chat pipeline.
const contextCache: {
    track: unknown;
    transport: unknown;
    workspace: unknown;
    midi: unknown;
    context: ProjectContext | null;
} = {
    track: null,
    transport: null,
    workspace: null,
    midi: null,
    context: null,
};

export function getProjectContext(): ProjectContext {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;
    // Read once per call instead of once per clip (§92.1). For a 100-track
    // project at ~20 clips each that's 2000 store dereferences → 1.
    const midiState = midiStore.value;
    const notesByClipId = midiState?.notesByClipId;

    if (
        contextCache.context !== null &&
        contextCache.track === trackState &&
        contextCache.transport === transportState &&
        contextCache.workspace === workspaceState &&
        contextCache.midi === midiState
    ) {
        return contextCache.context;
    }

    const selectedTrackId = trackState?.selectedTrackId ?? null;
    const selectedClipId = workspaceState?.selectedClipId ?? null;
    const selectedClipIds = workspaceState?.selectedClipIds ?? [];

    const built: ProjectContext = {
        tempo: transportState?.tempo ?? 120,
        timeSignature: [transportState?.timeSignatureNumerator ?? 4, transportState?.timeSignatureDenominator ?? 4],
        tracks: (trackState?.tracks ?? []).map((time) => ({
            id: time.id,
            name: time.name,
            kind: time.kind,
            muted: time.muted,
            soloed: time.soloed,
            armed: time.armed,
            gain: time.gain,
            pan: time.pan,
            clipCount: time.clips.length,
            deviceCount: time.devices.length,
            clips: time.clips.map((context) => ({
                id: context.id,
                name: context.name,
                type: context.type ?? 'audio',
                startBeat: context.startBeat,
                endBeat: context.endBeat,
                noteCount: context.type === 'midi' ? (notesByClipId?.[context.id]?.length ?? 0) : 0,
            })),
            devices: time.devices.map((data) => ({
                id: data.id,
                type: data.type,
                bypassed: data.bypassed,
            })),
        })),
        selectedTrackId,
        selectedClipId,
        selectedClipIds,
        activeView: workspaceState?.mode ?? 'arrange',
        playheadPosition: transportState?.playheadPosition ?? 0,
    };

    contextCache.track = trackState;
    contextCache.transport = transportState;
    contextCache.workspace = workspaceState;
    contextCache.midi = midiState;
    contextCache.context = built;
    return built;
}
