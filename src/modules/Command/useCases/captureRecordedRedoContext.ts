import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { undoStore } from '../stores/undoStore';

import { findPendingRedoEntry } from './findPendingRedoEntry';

/** Capture the same exact pending entry used by inverse reconciliation, before any dispatch wait. */
export function captureRecordedRedoContext(action: AppAction): HandlerValidationContext['recordedRedo'] {
    const entry = findPendingRedoEntry(action);
    if (!entry) {
        return undefined;
    }
    const inverseAction = entry.inverseAction;
    return {
        inverseAction,
        isCurrent: () =>
            undoStore.value?.future.includes(entry) === true &&
            (entry.redoAction ?? entry.action) === action &&
            entry.inverseAction === inverseAction,
    };
}
