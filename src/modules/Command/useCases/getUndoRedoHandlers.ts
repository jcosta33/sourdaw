import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleRedo } from '../handlers/undoRedo/handleRedo';
import { handleUndo } from '../handlers/undoRedo/handleUndo';

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
