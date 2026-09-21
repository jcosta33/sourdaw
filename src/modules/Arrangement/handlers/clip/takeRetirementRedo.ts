import { undoHistoryStore } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';

/**
 * The inverse of the undo entry whose redo this dispatch is replaying.
 *
 * `redo()` replays `entry.redoAction ?? entry.action` while the entry is still
 * on the `future` stack, so the pairing is readable only during that replay:
 * `undefined` means nothing is paired — an ordinary forward dispatch — and
 * `null` that the paired entry carries no inverse.
 *
 * Read through the public undo history store rather than by handing the actions
 * a shared object: the session mirror parses an entry's halves into independent
 * objects, so a capture two payloads share by reference is empty on one of them
 * once the entry crossed a reload.
 */
export function pairedInverseForRedo(action: object): AppAction | null | undefined {
    for (const entry of undoHistoryStore.value?.future ?? []) {
        if (entry.kind !== 'action' || (entry.redoAction ?? entry.action) !== action) {
            continue;
        }
        return entry.inverseAction;
    }
    return undefined;
}

/**
 * Put back the takes the pending discard of `clipId` captured when it ran at
 * undo time. A clip-creating redo re-uses the clip id its undo retired —
 * `duplicateClip` its cached target, `addClip` and the other duplicate routes
 * their pinned ids — so the capture on that still-pending entry is what the
 * re-created clip's lane has to be reconciled against.
 *
 * Keyed by clip id rather than by the replayed action: the duplicate handlers
 * canonicalize their arguments through a clone, so the action a redo replays is
 * not the object its entry holds, while the pinned id is on both.
 */
export function restoreTakesRetiredByPendingDiscard(clipId: string): void {
    for (const entry of undoHistoryStore.value?.future ?? []) {
        if (entry.kind !== 'action') {
            continue;
        }
        const inverse = entry.inverseAction;
        if (inverse?.type === 'discardDuplicatedClip' && inverse.payload.clipId === clipId) {
            restoreTakesForClip(inverse.payload.retiredTakeLanes ?? []);
            return;
        }
    }
}

/**
 * Refresh the capture of the entry this removal is replaying.
 *
 * A removal's `describe()` re-captures on the redo leg, but the redo runs with
 * `skipUndo`, so that fresh capture never reaches an entry and the entry keeps
 * what the first removal wrote. A take that landed on the restored clip in
 * between is then absent from the capture the following undo reads, and is
 * lost. Writing the fresh capture onto the paired entry keeps its inverse
 * describing what its own replay actually retired.
 */
export function refreshRetiredTakeLanesForRedo(action: object, clipId: string): void {
    const inverse = pairedInverseForRedo(action);
    if (inverse?.type !== 'restoreClip') {
        return;
    }
    inverse.payload.retiredTakeLanes = captureRetiredTakeLanes([clipId]);
}
