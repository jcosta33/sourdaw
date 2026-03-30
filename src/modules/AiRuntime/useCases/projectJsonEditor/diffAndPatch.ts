/**
 * Diff original vs edited project JSON and extract actionable changes.
 *
 * This is the core of the JSON editor flow: the LLM returns a modified
 * version of the project state, and we diff it against the original
 * to figure out what changed, then apply those changes to the real stores.
 *
 * Includes:
 * - Destructive flag for safety gating
 * - Inverse change generation for undo
 * - Semantic validation (timeline, parameter ranges, reference integrity)
 */
import {
    type EditableProjectState,
    type EditableTrack,
    type EditableClip,
    type EditableDevice,
    type EditableNote,
} from './serializeProjectState';

// ── Change types ─────────────────────────────────────────────────────────────

export type ProjectChange =
    | { type: 'set_tempo'; value: number }
    | { type: 'set_time_signature'; numerator: number; denominator: number }
    | { type: 'add_track'; id: string; track: EditableTrack }
    | { type: 'remove_track'; id: string; removedTrack: EditableTrack }
    | { type: 'update_track'; id: string; field: string; value: unknown; previousValue: unknown }
    | { type: 'reorder_tracks'; order: string[]; previousOrder: string[] }
    | { type: 'add_clip'; trackId: string; clipId: string; clip: EditableClip }
    | { type: 'remove_clip'; trackId: string; clipId: string; removedClip: EditableClip }
    | { type: 'update_clip'; trackId: string; clipId: string; field: string; value: unknown; previousValue: unknown }
    | { type: 'add_device'; trackId: string; deviceId: string; device: EditableDevice }
    | { type: 'remove_device'; trackId: string; deviceId: string; removedDevice: EditableDevice }
    | {
          type: 'update_device';
          trackId: string;
          deviceId: string;
          field: string;
          value: unknown;
          previousValue: unknown;
      }
    | {
          type: 'update_clip_notes';
          trackId: string;
          clipId: string;
          notes: EditableNote[];
          previousNotes: EditableNote[];
      }
    | { type: 'set_selection'; trackId: string | null; clipIds: string[] };

/**
 * Whether a change is destructive (requires confirmation before apply).
 */
export function isDestructiveChange(change: ProjectChange): boolean {
    return (
        change.type === 'remove_track' ||
        change.type === 'remove_clip' ||
        change.type === 'remove_device' ||
        change.type === 'reorder_tracks'
    );
}

/**
 * Whether any change in the list is destructive.
 */
export function hasDestructiveChanges(changes: ProjectChange[]): boolean {
    return changes.some(isDestructiveChange);
}

// ── Validation ───────────────────────────────────────────────────────────────

export type ValidationError = {
    change: ProjectChange;
    reason: string;
};

/**
 * Validate a set of proposed changes before application.
 * Returns errors for invalid changes; empty array = all valid.
 */
export function validateChanges(changes: ProjectChange[], original: EditableProjectState): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const change of changes) {
        switch (change.type) {
            case 'set_tempo': {
                if (change.value < 20 || change.value > 999) {
                    errors.push({ change, reason: `Tempo ${change.value} out of range (20-999)` });
                }
                break;
            }

            case 'set_time_signature': {
                if (change.numerator < 1 || change.numerator > 32) {
                    errors.push({ change, reason: `Time sig numerator ${change.numerator} out of range (1-32)` });
                }
                if (change.denominator < 1 || change.denominator > 32) {
                    errors.push({
                        change,
                        reason: `Time sig denominator ${change.denominator} out of range (1-32)`,
                    });
                }
                break;
            }

            case 'remove_track': {
                if (!original.tracks[change.id]) {
                    errors.push({ change, reason: `Track ${change.id} does not exist` });
                }
                break;
            }

            case 'update_track': {
                if (!original.tracks[change.id]) {
                    errors.push({ change, reason: `Track ${change.id} does not exist` });
                }
                // Validate gain range
                if (change.field === 'gain' && typeof change.value === 'number') {
                    if (change.value < 0 || change.value > 1.5) {
                        errors.push({ change, reason: `Gain ${change.value} out of range (0-1.5)` });
                    }
                }
                // Validate pan range
                if (change.field === 'pan' && typeof change.value === 'number') {
                    if (change.value < -50 || change.value > 50) {
                        errors.push({ change, reason: `Pan ${change.value} out of range (-50 to 50)` });
                    }
                }
                break;
            }

            case 'add_clip':
            case 'update_clip': {
                // Validate beat ranges
                const clip = change.type === 'add_clip' ? change.clip : null;
                if (clip) {
                    if (clip.startBeat < 0) {
                        errors.push({ change, reason: `Clip start beat ${clip.startBeat} cannot be negative` });
                    }
                    if (clip.endBeat <= clip.startBeat) {
                        errors.push({ change, reason: `Clip end beat must be after start beat` });
                    }
                }
                if (change.type === 'update_clip') {
                    if (change.field === 'startBeat' && typeof change.value === 'number' && change.value < 0) {
                        errors.push({ change, reason: `Start beat cannot be negative` });
                    }
                }
                // Check track exists
                if (!original.tracks[change.trackId]) {
                    // Track might be a newly added one — check if there's an add_track for it
                    const hasAddTrack = changes.some((c) => c.type === 'add_track' && c.id === change.trackId);
                    if (!hasAddTrack) {
                        errors.push({ change, reason: `Track ${change.trackId} does not exist` });
                    }
                }
                break;
            }

            case 'remove_clip': {
                const track = original.tracks[change.trackId];
                if (track && !track.clips[change.clipId]) {
                    errors.push({ change, reason: `Clip ${change.clipId} does not exist in track` });
                }
                break;
            }

            case 'remove_device': {
                const track = original.tracks[change.trackId];
                if (track && !track.devices[change.deviceId]) {
                    errors.push({ change, reason: `Device ${change.deviceId} does not exist in track` });
                }
                break;
            }

            case 'update_clip_notes': {
                for (let i = 0; i < change.notes.length; i++) {
                    const note = change.notes[i]!;
                    if (note.pitch < 0 || note.pitch > 127) {
                        errors.push({ change, reason: `Note ${i} pitch ${note.pitch} out of range (0-127)` });
                    }
                    if (note.velocity < 0 || note.velocity > 127) {
                        errors.push({ change, reason: `Note ${i} velocity ${note.velocity} out of range (0-127)` });
                    }
                    if (note.duration <= 0) {
                        errors.push({ change, reason: `Note ${i} duration must be positive` });
                    }
                    if (note.startBeat < 0) {
                        errors.push({ change, reason: `Note ${i} startBeat cannot be negative` });
                    }
                }
                break;
            }

            case 'reorder_tracks': {
                // All IDs in new order must exist (in original or as added tracks)
                for (const id of change.order) {
                    if (!original.tracks[id]) {
                        const hasAddTrack = changes.some((c) => c.type === 'add_track' && c.id === id);
                        if (!hasAddTrack) {
                            errors.push({ change, reason: `Track ${id} in reorder does not exist` });
                        }
                    }
                }
                break;
            }
        }
    }

    return errors;
}

// ── Diffing ──────────────────────────────────────────────────────────────────

/**
 * Diff original project state against the LLM-edited version.
 * Returns a list of concrete changes to apply, each carrying its inverse data.
 */
export function diffProjectState(original: EditableProjectState, edited: EditableProjectState): ProjectChange[] {
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

    for (const id of editedTrackIds) {
        if (!originalTrackIds.has(id)) {
            changes.push({ type: 'add_track', id, track: edited.tracks[id]! });
        }
    }

    for (const id of originalTrackIds) {
        if (!editedTrackIds.has(id)) {
            changes.push({ type: 'remove_track', id, removedTrack: original.tracks[id]! });
        }
    }

    if (JSON.stringify(edited.track_order) !== JSON.stringify(original.track_order)) {
        changes.push({
            type: 'reorder_tracks',
            order: edited.track_order,
            previousOrder: original.track_order,
        });
    }

    for (const id of editedTrackIds) {
        if (!originalTrackIds.has(id)) {
            continue;
        }
        const orig = original.tracks[id]!;
        const edit = edited.tracks[id]!;

        for (const field of ['name', 'kind', 'muted', 'soloed', 'armed', 'gain', 'pan', 'color'] as const) {
            if (edit[field] !== orig[field]) {
                changes.push({
                    type: 'update_track',
                    id,
                    field,
                    value: edit[field],
                    previousValue: orig[field],
                });
            }
        }

        diffClips(id, orig, edit, changes);
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

function diffClips(trackId: string, orig: EditableTrack, edit: EditableTrack, changes: ProjectChange[]): void {
    const origClipIds = new Set(Object.keys(orig.clips));
    const editClipIds = new Set(Object.keys(edit.clips));

    for (const clipId of editClipIds) {
        if (!origClipIds.has(clipId)) {
            changes.push({ type: 'add_clip', trackId, clipId, clip: edit.clips[clipId]! });
        }
    }

    for (const clipId of origClipIds) {
        if (!editClipIds.has(clipId)) {
            changes.push({
                type: 'remove_clip',
                trackId,
                clipId,
                removedClip: orig.clips[clipId]!,
            });
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
                changes.push({
                    type: 'update_clip',
                    trackId,
                    clipId,
                    field,
                    value: editClip[field],
                    previousValue: origClip[field],
                });
            }
        }

        // MIDI note-level diff (when notes are present in both)
        if (origClip.notes && editClip.notes) {
            if (JSON.stringify(origClip.notes) !== JSON.stringify(editClip.notes)) {
                changes.push({
                    type: 'update_clip_notes',
                    trackId,
                    clipId,
                    notes: editClip.notes,
                    previousNotes: origClip.notes,
                });
            }
        }
    }
}

function diffDevices(trackId: string, orig: EditableTrack, edit: EditableTrack, changes: ProjectChange[]): void {
    const origDeviceIds = new Set(Object.keys(orig.devices));
    const editDeviceIds = new Set(Object.keys(edit.devices));

    for (const deviceId of editDeviceIds) {
        if (!origDeviceIds.has(deviceId)) {
            changes.push({
                type: 'add_device',
                trackId,
                deviceId,
                device: edit.devices[deviceId]!,
            });
        }
    }

    for (const deviceId of origDeviceIds) {
        if (!editDeviceIds.has(deviceId)) {
            changes.push({
                type: 'remove_device',
                trackId,
                deviceId,
                removedDevice: orig.devices[deviceId]!,
            });
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
                changes.push({
                    type: 'update_device',
                    trackId,
                    deviceId,
                    field,
                    value: editDev[field],
                    previousValue: origDev[field],
                });
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
                return `Remove track "${c.removedTrack.name}"`;
            case 'update_track':
                return `Set track ${c.id} ${c.field} to ${JSON.stringify(c.value)}`;
            case 'reorder_tracks':
                return `Reorder tracks`;
            case 'add_clip':
                return `Add clip "${c.clip.name}" to track ${c.trackId} at beat ${c.clip.startBeat}`;
            case 'remove_clip':
                return `Remove clip "${c.removedClip.name}" from track ${c.trackId}`;
            case 'update_clip':
                return `Set clip ${c.clipId} ${c.field} to ${JSON.stringify(c.value)}`;
            case 'add_device':
                return `Add ${c.device.type} to track ${c.trackId}`;
            case 'remove_device':
                return `Remove ${c.removedDevice.type} from track ${c.trackId}`;
            case 'update_device':
                return `Set device ${c.deviceId} ${c.field} to ${JSON.stringify(c.value)}`;
            case 'update_clip_notes': {
                const added = c.notes.length - c.previousNotes.length;
                if (added > 0) {
                    return `Added ${added} note${added !== 1 ? 's' : ''} to clip ${c.clipId}`;
                }
                if (added < 0) {
                    return `Removed ${-added} note${added !== -1 ? 's' : ''} from clip ${c.clipId}`;
                }
                return `Modified ${c.notes.length} notes in clip ${c.clipId}`;
            }
            case 'set_selection':
                return `Change selection`;
            default:
                return `Unknown change`;
        }
    });
}
