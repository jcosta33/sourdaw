import { createCallbackUndoEntry, type UndoSource } from '../models/UndoEntry';
import { recordToTree } from '../useCases/undoTree/recordToTree';

import { pushUndo } from './undoStore';

type PushUndoEntryOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: UndoSource;
};

export function pushUndoEntry(
    label: string,
    undoFn: () => void,
    redoFn: () => void,
    options?: PushUndoEntryOptions
): void {
    const entry = createCallbackUndoEntry(label, undoFn, redoFn, options?.source ?? 'manual');
    if (options?.groupId) {
        entry.groupId = options.groupId;
        entry.groupLabel = options.groupLabel;
    }

    pushUndo(entry);
    recordToTree(entry);
}
