import { undoHistoryStore } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

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
