import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../models/UndoEntry';

type RecordedRedoBinding = {
    entry: ActionUndoEntry;
    requestedAction: AppAction;
    isCurrent: () => boolean;
};

// Only dispatcher-captured contexts can authorize a canonical action identity.
export const recordedRedoBindings = {
    contexts: new WeakMap<object, RecordedRedoBinding>(),
    actions: new WeakMap<AppAction, RecordedRedoBinding>(),
};
