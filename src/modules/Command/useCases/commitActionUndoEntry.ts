import { type AppAction } from '#/utils/handlerContract';

import { type UndoSource } from '../models/UndoEntry';
import { commitActionUndoEntry as commitActionUndoEntryToStore } from '../stores/commitActionUndoEntry';

type CommitActionUndoEntryInput = {
    action: AppAction;
    inverseAction: AppAction | null;
    label: string;
    source?: UndoSource;
    groupId?: string;
    groupLabel?: string;
};

export function commitActionUndoEntry(input: CommitActionUndoEntryInput): void {
    commitActionUndoEntryToStore(input);
}
