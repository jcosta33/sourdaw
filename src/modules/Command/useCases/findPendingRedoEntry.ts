import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

export function findPendingRedoEntry(replayAction: AppAction): ActionUndoEntry | undefined {
    const entry = undoStore.value?.future.find(
        (candidate) => candidate.kind === 'action' && (candidate.redoAction ?? candidate.action) === replayAction
    );
    return entry?.kind === 'action' ? entry : undefined;
}
