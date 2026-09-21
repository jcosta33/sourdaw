import { undoHistoryStore } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';

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
