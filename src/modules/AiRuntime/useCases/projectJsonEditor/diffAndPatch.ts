/**
 * Diff original vs edited project JSON and extract actionable changes.
 *
 * This is the core of the JSON editor flow: the LLM returns a modified
 * version of the project state, and we diff it against the original
 * to figure out what changed, then apply those changes to the real stores.
 */
import { type EditableProjectState, type EditableTrack, type EditableClip, type EditableDevice } from './serializeProjectState';

// ── Change types ─────────────────────────────────────────────────────────────

export type ProjectChange =
    | { type: 'set_tempo'; value: number }
    | { type: 'set_time_signature'; numerator: number; denominator: number }
    | { type: 'add_track'; id: string; track: EditableTrack }
    | { type: 'remove_track'; id: string }
    | { type: 'update_track'; id: string; field: string; value: unknown }
    | { type: 'reorder_tracks'; order: string[] }
    | { type: 'add_clip'; trackId: string; clipId: string; clip: EditableClip }
    | { type: 'remove_clip'; trackId: string; clipId: string }
    | { type: 'update_clip'; trackId: string; clipId: string; field: string; value: unknown }
    | { type: 'add_device'; trackId: string; deviceId: string; device: EditableDevice }
    | { type: 'remove_device'; trackId: string; deviceId: string }
    | { type: 'update_device'; trackId: string; deviceId: string; field: string; value: unknown }
    | { type: 'set_selection'; trackId: string | null; clipIds: string[] };

/**
 * Diff original project state against the LLM-edited version.
 * Returns a list of concrete changes to apply.
 */
export function diffProjectState(
    original: EditableProjectState,
    edited: EditableProjectState,
): ProjectChange[] {
    const changes: ProjectChange[] = [];

    // ── Transport changes ────────────────────────────────────────────────
    if (edited.transport.tempo !== original.transport.tempo) {
        changes.push({ type: 'set_tempo', value: edited.transport.tempo });
    }
    if (
        edited.transport.timeSignatureNumerator !== original.transport.timeSignatureNumerator ||
        edited.transport.timeSignatureDenominator !== original.transport.timeSignatureDenominator
    ) {
        changes.push({
            type: 'set_time_signature',
            numerator: edited.transport.timeSignatureNumerator,
            denominator: edited.transport.timeSignatureDenominator,
        });
    }

    // ── Track changes ────────────────────────────────────────────────────

    const originalTrackIds = new Set(Object.keys(original.tracks));
    const editedTrackIds = new Set(Object.keys(edited.tracks));

    // Added tracks
    for (const id of editedTrackIds) {
        if (!originalTrackIds.has(id)) {
            changes.push({ type: 'add_track', id, track: edited.tracks[id]! });
        }
    }

    // Removed tracks
    for (const id of originalTrackIds) {
        if (!editedTrackIds.has(id)) {
            changes.push({ type: 'remove_track', id });
        }
    }

    // Track order change
    if (JSON.stringify(edited.track_order) !== JSON.stringify(original.track_order)) {
        changes.push({ type: 'reorder_tracks', order: edited.track_order });
    }

    // Modified tracks
    for (const id of editedTrackIds) {
        if (!originalTrackIds.has(id)) {
            continue; // Already handled as add
        }

        const orig = original.tracks[id]!;
        const edit = edited.tracks[id]!;

        // Track-level scalar fields
        for (const field of ['name', 'kind', 'muted', 'soloed', 'armed', 'gain', 'pan', 'color'] as const) {
            if (edit[field] !== orig[field]) {
                changes.push({ type: 'update_track', id, field, value: edit[field] });
            }
        }

        // Clip changes within track
        diffClips(id, orig, edit, changes);

        // Device changes within track
        diffDevices(id, orig, edit, changes);
    }

    // ── Selection changes ────────────────────────────────────────────────
    if (
        edited.selection.trackId !== original.selection.trackId ||
        JSON.stringify(edited.selection.clipIds) !== JSON.stringify(original.selection.clipIds)
    ) {
        changes.push({
            type: 'set_selection',
            trackId: edited.selection.trackId,
            clipIds: edited.selection.clipIds,
        });
    }

    return changes;
}

function diffClips(
    trackId: string,
    orig: EditableTrack,
    edit: EditableTrack,
    changes: ProjectChange[],
): void {
    const origClipIds = new Set(Object.keys(orig.clips));
    const editClipIds = new Set(Object.keys(edit.clips));

    for (const clipId of editClipIds) {
        if (!origClipIds.has(clipId)) {
            changes.push({ type: 'add_clip', trackId, clipId, clip: edit.clips[clipId]! });
        }
    }

    for (const clipId of origClipIds) {
        if (!editClipIds.has(clipId)) {
            changes.push({ type: 'remove_clip', trackId, clipId });
        }
    }

    for (const clipId of editClipIds) {
        if (!origClipIds.has(clipId)) {
            continue;
        }
        const origClip = orig.clips[clipId]!;
        const editClip = edit.clips[clipId]!;

        for (const field of ['name', 'type', 'startBeat', 'endBeat', 'audioBufferId'] as const) {
            if (editClip[field] !== origClip[field]) {
                changes.push({ type: 'update_clip', trackId, clipId, field, value: editClip[field] });
            }
        }
    }
}

function diffDevices(
    trackId: string,
    orig: EditableTrack,
    edit: EditableTrack,
    changes: ProjectChange[],
): void {
    const origDeviceIds = new Set(Object.keys(orig.devices));
    const editDeviceIds = new Set(Object.keys(edit.devices));

    for (const deviceId of editDeviceIds) {
        if (!origDeviceIds.has(deviceId)) {
            changes.push({ type: 'add_device', trackId, deviceId, device: edit.devices[deviceId]! });
        }
    }

    for (const deviceId of origDeviceIds) {
        if (!editDeviceIds.has(deviceId)) {
            changes.push({ type: 'remove_device', trackId, deviceId });
        }
    }

    for (const deviceId of editDeviceIds) {
        if (!origDeviceIds.has(deviceId)) {
            continue;
        }
        const origDev = orig.devices[deviceId]!;
        const editDev = edit.devices[deviceId]!;

        for (const field of ['type', 'bypassed'] as const) {
            if (editDev[field] !== origDev[field]) {
                changes.push({ type: 'update_device', trackId, deviceId, field, value: editDev[field] });
            }
        }
    }
}

/**
 * Generate human-readable summary of changes.
 */
export function summarizeChanges(changes: ProjectChange[]): string[] {
    return changes.map((c) => {
        switch (c.type) {
            case 'set_tempo':
                return `Set tempo to ${c.value} BPM`;
            case 'set_time_signature':
                return `Set time signature to ${c.numerator}/${c.denominator}`;
            case 'add_track':
                return `Add track "${c.track.name}" (${c.track.kind})`;
            case 'remove_track':
                return `Remove track ${c.id}`;
            case 'update_track':
                return `Set track ${c.id} ${c.field} to ${JSON.stringify(c.value)}`;
            case 'reorder_tracks':
                return `Reorder tracks`;
            case 'add_clip':
                return `Add clip "${c.clip.name}" to track ${c.trackId} at beat ${c.clip.startBeat}`;
            case 'remove_clip':
                return `Remove clip ${c.clipId} from track ${c.trackId}`;
            case 'update_clip':
                return `Set clip ${c.clipId} ${c.field} to ${JSON.stringify(c.value)}`;
            case 'add_device':
                return `Add ${c.device.type} to track ${c.trackId}`;
            case 'remove_device':
                return `Remove device ${c.deviceId} from track ${c.trackId}`;
            case 'update_device':
                return `Set device ${c.deviceId} ${c.field} to ${JSON.stringify(c.value)}`;
            case 'set_selection':
                return `Change selection`;
            default:
                return `Unknown change`;
        }
    });
}
