import { handleRedo } from '../handlers/undoRedo/handleRedo';
import { handleUndo } from '../handlers/undoRedo/handleUndo';
import { type AppAction } from '../models/AppAction';

import { type ActionHandler } from './executeAppAction';

type UndoRedoAppAction = Extract<AppAction, { type: 'undo' }> | Extract<AppAction, { type: 'redo' }>;

export type UndoRedoHandlersMap = {
    [Action in UndoRedoAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges undo/redo `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getUndoRedoHandlers(): UndoRedoHandlersMap {
    return {
        undo: handleUndo,
        redo: handleRedo,
    };
}
