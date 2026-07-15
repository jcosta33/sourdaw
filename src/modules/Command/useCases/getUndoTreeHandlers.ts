import { handleLabelUndoBranch } from '../handlers/undoTree/handleLabelUndoBranch';
import { handleToggleUndoTree } from '../handlers/undoTree/handleToggleUndoTree';
import { type AppAction } from '../models/AppAction';

import { type ActionHandler } from './executeAppAction';

type UndoTreeAppAction =
    | Extract<AppAction, { type: 'toggleUndoTree' }>
    | Extract<AppAction, { type: 'labelUndoBranch' }>;

export type UndoTreeHandlersMap = {
    [Action in UndoTreeAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges undo-tree `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getUndoTreeHandlers(): UndoTreeHandlersMap {
    return {
        toggleUndoTree: handleToggleUndoTree,
        labelUndoBranch: handleLabelUndoBranch,
    };
}
