import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { recordedRedoBindings } from './recordedRedoBindings';

export function findPendingRedoEntry(replayAction: AppAction): ActionUndoEntry | undefined {
    const binding = recordedRedoBindings.actions.get(replayAction);
    if (binding) {
        return binding.isCurrent() ? binding.entry : undefined;
    }
    const entry = undoStore.value?.future.find(
        (candidate) => candidate.kind === 'action' && (candidate.redoAction ?? candidate.action) === replayAction
    );
    return entry?.kind === 'action' ? entry : undefined;
}
