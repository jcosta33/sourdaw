import { type UndoSource } from '../models/UndoEntry';

import { commitUndoEntry } from './commitUndoEntry';
import { createCallbackUndoEntry } from './createCallbackUndoEntry';

type PushUndoEntryOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: UndoSource;
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
    });
    if (options?.groupId) {
        entry.groupId = options.groupId;
        entry.groupLabel = options.groupLabel;
    }

    commitUndoEntry(entry);
}
