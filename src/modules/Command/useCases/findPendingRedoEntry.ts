import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { recordedRedoBindings } from './recordedRedoBindings';

export function findPendingRedoEntry(replayAction: AppAction): ActionUndoEntry | undefined {
    const entry = undoStore.value?.future.find(
        (candidate) => candidate.kind === 'action' && (candidate.redoAction ?? candidate.action) === replayAction
    );
    if (entry?.kind === 'action') {
        return entry;
    }
    const binding = recordedRedoBindings.actions.get(replayAction);
    return binding?.isCurrent() ? binding.entry : undefined;
}
