import { createCallbackUndoEntry, type UndoSource } from '../models/UndoEntry';

import { commitUndoEntry } from './commitUndoEntry';

export function pushUndoEntry(
    label: string,
    undoFn: () => void,
    redoFn: () => void,
    options?: { groupId?: string; groupLabel?: string; source?: UndoSource }
): void {
    const entry = createCallbackUndoEntry(label, undoFn, redoFn, options?.source ?? 'manual');
    if (options?.groupId) {
        entry.groupId = options.groupId;
        entry.groupLabel = options.groupLabel;
    }
    commitUndoEntry(entry);
}
