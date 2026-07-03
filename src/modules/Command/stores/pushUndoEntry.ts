import { type UndoSource } from '../useCases/commandQueries';
import { commitUndoEntry } from '../useCases/commitUndoEntry';
import { createCallbackUndoEntry } from '../useCases/createCallbackUndoEntry';

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

    commitUndoEntry(entry);
}
