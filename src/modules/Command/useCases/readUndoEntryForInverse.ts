import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';

import { undoStore } from '../stores/undoStore';

/** Authenticate the actual pending inverse, without lending a caller mutable history. */
export function readUndoEntryForInverse(inverse: AppAction): HandlerSessionActionEntry | null {
    const state = undoStore.value;
    if (!state) {
        return null;
    }
    let match: HandlerSessionActionEntry | null = null;
    for (const entry of [...state.past, ...state.future]) {
        if (entry.kind !== 'action' || entry.inverseAction !== inverse) {
            continue;
        }
        if (match) {
            return null;
        }
        match = entry;
    }
    if (!match) {
        return null;
    }
    const captured: HandlerSessionActionEntry = {
        action: match.action,
        inverseAction: match.inverseAction,
        ...(match.redoAction ? { redoAction: match.redoAction } : {}),
    };
    return structuredClone(captured);
}
