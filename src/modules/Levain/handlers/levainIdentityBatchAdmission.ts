import { changesTrackOutsideDevicePlan } from '#/modules/Arrangement/useCases';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type SetLevainIdentityAction } from '../events/levainAppActions';

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
        return !changesTrackOutsideDevicePlan(sibling, trackId);
    });
}
