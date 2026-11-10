import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { undoStore } from '../stores/undoStore';

import { findPendingRedoEntry } from './findPendingRedoEntry';
import { recordedRedoBindings } from './recordedRedoBindings';

/** Capture the same exact pending entry used by inverse reconciliation, before any dispatch wait. */
export function captureRecordedRedoContext(action: AppAction): HandlerValidationContext['recordedRedo'] {
    const entry = findPendingRedoEntry(action);
    if (!entry) {
        return undefined;
    }
    const inverseAction = entry.inverseAction;
    const context: NonNullable<HandlerValidationContext['recordedRedo']> = {
        inverseAction,
        isCurrent: () =>
            recordedRedoBindings.contexts.get(context) === binding &&
            undoStore.value?.future.includes(entry) === true &&
            (entry.redoAction ?? entry.action) === action &&
            entry.inverseAction === inverseAction,
    };
    const binding = { entry, requestedAction: action, isCurrent: context.isCurrent };
    recordedRedoBindings.contexts.set(context, binding);
    return context;
}
