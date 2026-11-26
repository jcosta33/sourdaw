import { type AppAction, type HandlerDeviceOwnerChange, type HandlerValidationContext } from '#/utils/handlerContract';

import { undoStore } from '../stores/undoStore';

import { rebindDeviceHistory } from './rebindDeviceHistory';

type RestoreDeviceAction = Extract<AppAction, { type: 'restoreDevice' }>;

/** The exact pending inverse, together with the owned restore publication, carries history forward. */
function captureDeviceRemovalUndo(inverse: RestoreDeviceAction, entryId: string) {
    const entry = undoStore.value?.past.find((candidate) => candidate.id === entryId);
    if (
        entry?.kind !== 'action' ||
        entry.action.type !== 'removeDevice' ||
        entry.action.payload.deviceId !== inverse.payload.deviceSnapshot.id ||
        entry.inverseAction !== inverse
    ) {
        return null;
    }
    return (owner: HandlerDeviceOwnerChange): void => {
        const live = undoStore.value;
        const priorOwner = inverse.payload.removedOwner;
        if (
            !live?.past.includes(entry) ||
            entry.inverseAction !== inverse ||
            inverse.payload.trackId !== owner.trackId ||
            inverse.payload.deviceSnapshot.id !== owner.deviceId ||
            priorOwner?.trackObjectId !== owner.previous.trackObjectId ||
            priorOwner.deviceObjectId !== owner.previous.deviceObjectId
        ) {
            return;
        }
        rebindDeviceHistory(owner);
    };
}

export function captureDeviceHistoryRebind(
    requestedAction: AppAction,
    undoEntryId: string | undefined
): HandlerValidationContext['rebindDeviceHistory'] {
    if (requestedAction.type === 'reorderDevices') {
        return rebindDeviceHistory;
    }
    if (requestedAction.type === 'restoreDevice' && requestedAction.payload.removedOwner && undoEntryId !== undefined) {
        return captureDeviceRemovalUndo(requestedAction, undoEntryId) ?? undefined;
    }
    return undefined;
}
