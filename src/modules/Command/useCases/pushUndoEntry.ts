import { type UndoSource } from '../models/UndoEntry';

import { commitUndoEntry } from './commitUndoEntry';
import { createCallbackUndoEntry } from './createCallbackUndoEntry';

type PushUndoEntryOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: UndoSource;
    /** Audio buffer ids the closures can restore. See `CallbackUndoEntry`. */
    restoresBufferIds?: readonly string[];
};

export function pushUndoEntry(
    label: string,
    undoFn: () => void,
    redoFn: () => unknown,
    options?: PushUndoEntryOptions
): void {
    const entry = createCallbackUndoEntry({
        label,
        undo: undoFn,
        redo: redoFn,
        source: options?.source ?? 'manual',
        restoresBufferIds: options?.restoresBufferIds,
    });
    if (options?.groupId) {
        entry.groupId = options.groupId;
        entry.groupLabel = options.groupLabel;
    }

    commitUndoEntry(entry);
}
