import { type AppAction } from '#/utils/handlerContract';

import { isActionEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

/**
 * The inverse action paired with a redo action as that redo runs.
 *
 * `redo()` executes an entry's `redoAction` while the entry is still on the
 * future stack, so an inverse that records something at undo time that its own
 * redo needs can read it back here from the inverse's payload. That matters
 * across session hydration: the mirror serializes at commit time and parses the
 * two payloads into independent objects, so no shared array survives. Reading
 * the inverse's copy is what lets such a capture survive a reload.
 *
 * Returns null when no future entry owns this redo action — a redo replayed
 * outside the live stack has no paired inverse to read.
 */
export function readInverseActionForRedo(redoAction: AppAction): AppAction | null {
    const future = undoStore.value?.future ?? [];
    for (const entry of future) {
        if (isActionEntry(entry) && entry.redoAction === redoAction) {
            return entry.inverseAction;
        }
    }
    return null;
}
