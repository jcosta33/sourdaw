import { type AppAction } from '../models/AppAction';
import { createUndoEntry, type UndoSource } from '../models/UndoEntry';
import { commitUndoEntry } from '../useCases/commitUndoEntry';

type CommitActionUndoEntryInput = {
    action: AppAction;
    inverseAction: AppAction | null;
    label: string;
    source?: UndoSource;
    groupId?: string;
    groupLabel?: string;
};

export function commitActionUndoEntry({
    action,
    inverseAction,
    label,
    source = 'manual',
    groupId,
    groupLabel,
}: CommitActionUndoEntryInput): void {
    const entry = createUndoEntry(label, action, inverseAction, source);

    if (groupId) {
        entry.groupId = groupId;
        entry.groupLabel = groupLabel;
    }

    commitUndoEntry(entry);
}
