import { type AppAction } from '../models/AppAction';
import { type UndoSource } from '../models/UndoEntry';
import { createUndoEntry } from '../useCases/commandQueries';
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
