import { undoStore } from '../stores/undoStore';

/**
 * Whether any entry in the undo/redo history could still restore a clip that
 * references `bufferId`.
 *
 * Removing a clip is undoable: its inverse (`restoreClip`) carries the removed
 * clip as a snapshot, and undo re-appends that snapshot verbatim — including
 * `audioBufferId`. The same is true of the other clip-restoring inverses and
 * redo legs, which is why both stacks are scanned and every replayable action
 * of an entry is inspected:
 *
 * - undo leg (`inverseAction`): `restoreClip` (the clip snapshot plus a ripple
 *   plan's removed clips), `restoreTrack` / `restoreTracks` (whole track
 *   snapshots whose clips travel inside), `restoreTrackClipStates`,
 *   `restoreClipGlueState`, `restoreStripSilenceState`,
 *   `restoreClipSplitState`, `restoreTrackAlternativeState` — each carries
 *   whole clip snapshots.
 * - redo leg (`action` / `redoAction`): the same snapshot shapes replayed
 *   forward, e.g. a paste whose forward action is a clip-state restore.
 *
 * The snapshot payloads are read structurally (the one field every clip
 * snapshot carries is `audioBufferId`), so this enumeration cannot drift from
 * the payload shapes: a future clip-restoring inverse is covered by the same
 * walk. A match means undo or redo would resurrect a clip referencing the
 * buffer, so callers must treat the buffer as owned until the entry leaves the
 * history.
 */
export function isAudioBufferReferencedByUndoHistory(bufferId: string): boolean {
    const state = undoStore.value;
    if (!state) {
        return false;
    }
    for (const entry of [...state.past, ...state.future]) {
        if (entry.kind !== 'action') {
            continue;
        }
        for (const action of [entry.action, entry.inverseAction, entry.redoAction]) {
            if (action && payloadReferencesBuffer(action, bufferId, 0, new WeakSet<object>())) {
                return true;
            }
        }
    }
    return false;
}

const MAX_SNAPSHOT_SCAN_DEPTH = 12;

function payloadReferencesBuffer(value: unknown, bufferId: string, depth: number, visited: WeakSet<object>): boolean {
    if (depth > MAX_SNAPSHOT_SCAN_DEPTH || value === null || typeof value !== 'object') {
        return false;
    }
    if (visited.has(value)) {
        return false;
    }
    visited.add(value);
    if (Array.isArray(value)) {
        return value.some((item) => payloadReferencesBuffer(item, bufferId, depth + 1, visited));
    }
    return Object.entries(value).some(([key, child]) => {
        if (key === 'audioBufferId') {
            return child === bufferId;
        }
        return payloadReferencesBuffer(child, bufferId, depth + 1, visited);
    });
}
