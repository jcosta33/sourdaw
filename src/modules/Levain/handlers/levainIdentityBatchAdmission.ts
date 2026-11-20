import { type AppAction, type AppActionType, type HandlerValidationContext } from '#/utils/handlerContract';

import { type SetLevainIdentityAction } from '../events/levainAppActions';

const unplannedTrackChanges = new Set<AppActionType>([
    'freezeTrack',
    'unfreezeTrack',
    'restoreFreezeState',
    'flattenTrack',
    'bounceInPlace',
    'loadPreset',
    'restorePresetDeviceChain',
    'removeTrack',
    'restoreTrack',
    'discardCreatedTrack',
]);

function replacesDevice(action: AppAction, deviceId: string): boolean {
    if (action.type === 'restoreDevice') {
        return action.payload.deviceSnapshot.id === deviceId;
    }
    return (
        (action.type === 'setDeviceState' || action.type === 'removeDevice' || action.type === 'addDevice') &&
        action.payload.deviceId === deviceId
    );
}

export function admitsLevainIdentityBatch(
    action: SetLevainIdentityAction,
    context?: HandlerValidationContext
): boolean {
    if (!context) {
        return true;
    }
    const { deviceId, trackId } = action.payload;
    return context.actions.every((sibling, index) => {
        if (index === context.actionIndex) {
            return true;
        }
        if (sibling.type === 'removeAllTracks' || replacesDevice(sibling, deviceId)) {
            return false;
        }
        if (sibling.type === 'discardImportedStemSet') {
            return sibling.payload.folderId !== trackId && !sibling.payload.stemTrackIds.includes(trackId);
        }
        return !(
            unplannedTrackChanges.has(sibling.type) &&
            sibling.payload &&
            'trackId' in sibling.payload &&
            sibling.payload.trackId === trackId
        );
    });
}
