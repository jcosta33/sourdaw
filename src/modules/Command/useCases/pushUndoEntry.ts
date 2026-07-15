import { type UndoSource } from '../models/UndoEntry';
import { pushUndoEntry as pushUndoEntryToStore } from '../stores/pushUndoEntry';

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
    pushUndoEntryToStore(label, undoFn, redoFn, options);
}
