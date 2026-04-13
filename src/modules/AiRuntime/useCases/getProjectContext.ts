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

export function getProjectContext(): ProjectContext {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;
    // Read once per call instead of once per clip (§92.1). For a 100-track
    // project at ~20 clips each that's 2000 store dereferences → 1.
    const midiState = midiStore.value;
    const notesByClipId = midiState?.notesByClipId;

    const selectedTrackId = trackState?.selectedTrackId ?? null;
    const selectedClipId = workspaceState?.selectedClipId ?? null;
    const selectedClipIds = workspaceState?.selectedClipIds ?? [];

    return {
        tempo: transportState?.tempo ?? 120,
        timeSignature: [transportState?.timeSignatureNumerator ?? 4, transportState?.timeSignatureDenominator ?? 4],
        tracks: (trackState?.tracks ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            muted: t.muted,
            soloed: t.soloed,
            armed: t.armed,
            gain: t.gain,
            pan: t.pan,
            clipCount: t.clips.length,
            deviceCount: t.devices.length,
            clips: t.clips.map((c) => ({
                id: c.id,
                name: c.name,
                type: c.type ?? 'audio',
                startBeat: c.startBeat,
                endBeat: c.endBeat,
                noteCount: c.type === 'midi' ? (notesByClipId?.[c.id]?.length ?? 0) : 0,
            })),
            devices: t.devices.map((d) => ({
                id: d.id,
                type: d.type,
                bypassed: d.bypassed,
            })),
        })),
        selectedTrackId,
        selectedClipId,
        selectedClipIds,
        activeView: workspaceState?.mode ?? 'arrange',
        playheadPosition: transportState?.playheadPosition ?? 0,
    };
}
