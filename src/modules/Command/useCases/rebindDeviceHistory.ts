import { type AppAction, type HandlerDeviceOwnerChange } from '#/utils/handlerContract';

import { getHandler } from '../stores/handlerRegistry';
import { undoStore } from '../stores/undoStore';

function rebindAction(action: AppAction, owner: HandlerDeviceOwnerChange): AppAction {
    const rebound = getHandler(action)?.rebindDeviceOwner?.(action, owner);
    return rebound?.type === action.type ? rebound : action;
}

/** Extend existing replay bindings with the exact owner produced by a local publication. */
export function rebindDeviceHistory(owner: HandlerDeviceOwnerChange): void {
    const live = undoStore.value;
    if (!live) {
        return;
    }
    for (const entry of [...live.past, ...live.future]) {
        if (entry.kind !== 'action') {
            continue;
        }
        // Keep the entry itself so the pending transition and branching history retain the update.
        entry.action = rebindAction(entry.action, owner);
        if (entry.inverseAction) {
            entry.inverseAction = rebindAction(entry.inverseAction, owner);
        }
        if (entry.redoAction) {
            entry.redoAction = rebindAction(entry.redoAction, owner);
        }
    }
}
