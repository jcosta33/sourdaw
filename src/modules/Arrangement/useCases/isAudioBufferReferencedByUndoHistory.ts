import { undoHistoryStore } from '#/modules/Command/stores';

import { collectTimeOperationPlanBufferIds } from './timeOperations/collectTimeOperationPlanBufferIds';

/**
 * Whether any entry in the undo/redo history could still restore a clip that
 * references `bufferId`. Both stacks are scanned and every replayable action of
 * an action entry is inspected:
 *
 * - undo leg (`inverseAction`) — `restoreClip` (clip snapshot plus a ripple
 *   plan's removed clips), `restoreTrack` / `restoreTracks` (whole track
 *   snapshots whose clips travel inside), `restoreTrackClipStates`,
 *   `restoreClipGlueState`, `restoreStripSilenceState`,
 *   `restoreClipSplitState`, `restoreTrackAlternativeState`, and
 *   `restoreTimeOperationState`, whose plans carry whole track state encoded by
 *   the time-operation codec and are decoded before scanning — an encoded tree
 *   hides `audioBufferId` from a plain walk.
 * - redo leg (`action` / `redoAction`) — the same shapes replayed forward, e.g.
 *   a paste whose forward action is a clip-state restore.
 *
 * Callback-kind entries carry no interpretable payload; they declare the buffer
 * ids their closures restore at push time (`restoresBufferIds`), and entries
 * without a declaration are treated as restoring no audio.
 *
 * A match means undo or redo would resurrect a clip referencing the buffer, so
 * callers must treat the buffer as owned until the entry leaves the history.
 */
export function isAudioBufferReferencedByUndoHistory(bufferId: string): boolean {
    const state = undoHistoryStore.value;
    if (!state) {
        return false;
    }
    for (const entry of [...state.past, ...state.future]) {
        if (entry.kind === 'callback') {
            if (entry.restoresBufferIds?.includes(bufferId)) {
                return true;
            }
            continue;
        }
        for (const action of [entry.action, entry.inverseAction, entry.redoAction]) {
            if (!action) {
                continue;
            }
            // Time-operation plans carry their track state encoded; decode that
            // first, then still run the plain walk so any plain-shaped field in
            // the payload is not missed.
            if (
                action.type === 'restoreTimeOperationState' &&
                collectTimeOperationPlanBufferIds(action.payload.plan).includes(bufferId)
            ) {
                return true;
            }
            if (payloadReferencesBuffer(action, bufferId, 0, new WeakSet<object>())) {
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
