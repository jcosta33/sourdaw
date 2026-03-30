/**
 * Serialize the current project state as an editable JSON document.
 *
 * Uses EASE encoding: stable IDs as keys (not positional arrays) so
 * the LLM can reference entities without index drift.
 *
 * The LLM receives this JSON, edits it, and returns the modified version.
 * We then diff original vs edited to extract changes.
 */
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';

export type EditableProjectState = {
    _revision: number;
    transport: {
        tempo: number;
        timeSignatureNumerator: number;
        timeSignatureDenominator: number;
        playheadPosition: number;
    };
    tracks: Record<string, EditableTrack>;
    track_order: string[];
    selection: {
        trackId: string | null;
        clipIds: string[];
    };
};

export type EditableTrack = {
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color?: string;
    clips: Record<string, EditableClip>;
    clip_order: string[];
    devices: Record<string, EditableDevice>;
    device_order: string[];
};

export type EditableClip = {
    name: string;
    type: 'audio' | 'midi';
    startBeat: number;
    endBeat: number;
    audioBufferId?: string;
    /** MIDI notes (only included when clip is selected or explicitly requested) */
    notes?: EditableNote[];
};

export type EditableNote = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

export type EditableDevice = {
    type: string;
    bypassed: boolean;
    params?: Record<string, number>;
};

let revisionCounter = 0;

/**
 * Serialize the full editable project state using EASE encoding.
 *
 * @param includeNotes If true, include MIDI notes for selected clips.
 * @param scopeTrackIds If provided, only include these tracks (selective injection).
 */
export function serializeProjectState(options?: {
    includeNotes?: boolean;
    scopeTrackIds?: string[];
}): EditableProjectState {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;
    const midiState = midiStore.value;

    const selectedClipIds = new Set(workspaceState?.selectedClipIds ?? []);
    const includeNotes = options?.includeNotes ?? false;
    const scopeTrackIds = options?.scopeTrackIds ? new Set(options.scopeTrackIds) : null;

    revisionCounter++;

    const tracks: Record<string, EditableTrack> = {};
    const trackOrder: string[] = [];

    for (const track of trackState?.tracks ?? []) {
        if (scopeTrackIds && !scopeTrackIds.has(track.id)) {
            continue;
        }

        const clips: Record<string, EditableClip> = {};
        const clipOrder: string[] = [];

        for (const clip of track.clips) {
            const editableClip: EditableClip = {
                name: clip.name,
                type: (clip.type as 'audio' | 'midi') ?? 'audio',
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                audioBufferId: clip.audioBufferId,
            };

            // Include MIDI notes if requested and clip is selected
            if (includeNotes && clip.type === 'midi' && selectedClipIds.has(clip.id)) {
                const notes = midiState?.notesByClipId[clip.id];
                if (notes) {
                    editableClip.notes = notes.map((n) => ({
                        pitch: n.pitch,
                        startBeat: n.startBeat,
                        duration: n.duration,
                        velocity: n.velocity,
                    }));
                }
            }

            clips[clip.id] = editableClip;
            clipOrder.push(clip.id);
        }

        const devices: Record<string, EditableDevice> = {};
        const deviceOrder: string[] = [];

        for (const device of track.devices) {
            devices[device.id] = {
                type: device.type,
                bypassed: device.bypassed,
            };
            deviceOrder.push(device.id);
        }

        tracks[track.id] = {
            name: track.name,
            kind: track.kind,
            muted: track.muted,
            soloed: track.soloed,
            armed: track.armed,
            gain: track.gain,
            pan: track.pan,
            color: track.color,
            clips,
            clip_order: clipOrder,
            devices,
            device_order: deviceOrder,
        };
        trackOrder.push(track.id);
    }

    return {
        _revision: revisionCounter,
        transport: {
            tempo: transportState?.tempo ?? 120,
            timeSignatureNumerator: transportState?.timeSignatureNumerator ?? 4,
            timeSignatureDenominator: transportState?.timeSignatureDenominator ?? 4,
            playheadPosition: transportState?.playheadPosition ?? 0,
        },
        tracks,
        track_order: trackOrder,
        selection: {
            trackId: trackState?.selectedTrackId ?? null,
            clipIds: [...(workspaceState?.selectedClipIds ?? [])],
        },
    };
}

/**
 * Get current revision number for concurrency checks.
 */
export function getCurrentRevision(): number {
    return revisionCounter;
}
