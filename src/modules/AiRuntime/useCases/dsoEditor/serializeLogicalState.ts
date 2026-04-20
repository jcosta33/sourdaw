/**
 * Serialize the project into EASE-encoded logical state for the LLM.
 *
 * EASE encoding: stable ID-keyed maps + explicit order arrays.
 * Only the logical state is sent — no MIDI notes, no automation points,
 * no waveforms, no plugin blobs — unless explicitly requested.
 *
 * Selective state injection: only include domains relevant to the request.
 */
import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';
import { workspaceStore } from '#/modules/Workspace/stores';

// ── Types ────────────────────────────────────────────────────────────────────

export type LogicalTrack = {
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color?: string;
    clip_ids: string[];
    device_ids: string[];
};

export type LogicalClip = {
    name: string;
    type: 'audio' | 'midi';
    track_id: string;
    start_beat: number;
    end_beat: number;
    gain?: number;
    note_count?: number;
};

export type LogicalDevice = {
    name?: string;
    type: string;
    track_id: string;
    bypassed: boolean;
};

export type LogicalState = {
    project_revision: number;
    transport: {
        tempo: number;
        time_signature: [number, number];
        playhead_beat: number;
    };
    tracks: Record<string, LogicalTrack>;
    track_order: string[];
    clips: Record<string, LogicalClip>;
    devices: Record<string, LogicalDevice>;
    selection: {
        track_ids: string[];
        clip_ids: string[];
    };
};

export type ProjectSummary = {
    project_revision: number;
    track_count: number;
    selected_tracks: string[];
    selected_clips: string[];
    tempo: number;
    routing_summary: string;
    recent_edits: string[];
};

// ── Revision + recent edits log ──────────────────────────────────────────────
// Held in a closure so the only way to mutate is via the exported functions.
// HMR resets are acceptable here: the LLM-facing revision counter only needs
// to be monotonic within a session, and recent-edits is a 5-entry history
// that can safely start empty after a reload.

const editLog: { revision: number; entries: string[] } = { revision: 0, entries: [] };

export function getRevision(): number {
    return editLog.revision;
}

export function logEdit(summary: string): void {
    editLog.entries.push(summary);
    if (editLog.entries.length > 5) {
        editLog.entries.shift();
    }
}

function bumpRevision(): number {
    return ++editLog.revision;
}

function getRecentEdits(): string[] {
    return [...editLog.entries];
}

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize the current project as EASE-encoded logical state.
 *
 * Options:
 * - scopeTrackIds: limit to specific tracks (selective injection)
 * - includeNoteCount: include note counts in clips (for MIDI-related edits)
 */
export function serializeLogicalState(options?: {
    scopeTrackIds?: string[];
    includeNoteCount?: boolean;
}): LogicalState {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;
    const midiState = midiStore.value;

    const scopeSet = options?.scopeTrackIds ? new Set(options.scopeTrackIds) : null;

    const revision = bumpRevision();

    const tracks: Record<string, LogicalTrack> = {};
    const trackOrder: string[] = [];
    const clips: Record<string, LogicalClip> = {};
    const devices: Record<string, LogicalDevice> = {};

    for (const track of trackState?.tracks ?? []) {
        if (scopeSet && !scopeSet.has(track.id)) {
            continue;
        }

        const clipIds: string[] = [];
        for (const clip of track.clips) {
            const logicalClip: LogicalClip = {
                name: clip.name,
                type: clip.type ?? 'audio',
                track_id: track.id,
                start_beat: clip.startBeat,
                end_beat: clip.endBeat,
                gain: (clip as Record<string, unknown>).gain as number | undefined,
            };

            if (options?.includeNoteCount && clip.type === 'midi') {
                logicalClip.note_count = midiState?.notesByClipId[clip.id]?.length ?? 0;
            }

            clips[clip.id] = logicalClip;
            clipIds.push(clip.id);
        }

        const deviceIds: string[] = [];
        for (const device of track.devices) {
            devices[device.id] = {
                name: (device as Record<string, unknown>).name as string | undefined,
                type: device.type,
                track_id: track.id,
                bypassed: device.bypassed,
            };
            deviceIds.push(device.id);
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
            clip_ids: clipIds,
            device_ids: deviceIds,
        };
        trackOrder.push(track.id);
    }

    return {
        project_revision: revision,
        transport: {
            tempo: transportState?.tempo ?? 120,
            time_signature: [
                transportState?.timeSignatureNumerator ?? 4,
                transportState?.timeSignatureDenominator ?? 4,
            ],
            playhead_beat: transportState?.playheadPosition ?? 0,
        },
        tracks,
        track_order: trackOrder,
        clips,
        devices,
        selection: {
            track_ids: trackState?.selectedTrackId ? [trackState.selectedTrackId] : [],
            clip_ids: [...(workspaceState?.selectedClipIds ?? [])],
        },
    };
}

/**
 * Build a compact project summary for prompt context.
 */
export function buildProjectSummary(): ProjectSummary {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;

    return {
        project_revision: editLog.revision,
        track_count: trackState?.tracks.length ?? 0,
        selected_tracks: trackState?.selectedTrackId ? [trackState.selectedTrackId] : [],
        selected_clips: [...(workspaceState?.selectedClipIds ?? [])],
        tempo: transportState?.tempo ?? 120,
        routing_summary: buildRoutingSummary(),
        recent_edits: getRecentEdits(),
    };
}

function buildRoutingSummary(): string {
    const trackState = trackStore.value;
    if (!trackState || trackState.tracks.length === 0) {
        return 'Empty project';
    }
    const names = trackState.tracks.slice(0, 8).map((t) => t.name);
    if (trackState.tracks.length > 8) {
        return `${names.join(', ')} +${trackState.tracks.length - 8} more → Master`;
    }
    return `${names.join(', ')} → Master`;
}
