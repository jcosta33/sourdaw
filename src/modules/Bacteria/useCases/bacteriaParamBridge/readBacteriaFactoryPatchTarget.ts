import { getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';
import { type HandlerValidationContext } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

export function readBacteriaFactoryPatchTarget(
    deviceId: string,
    parameterIds: readonly string[],
    trackId?: string,
    context?: HandlerValidationContext
) {
    const planned = getPlannedDevicePatchState({ deviceId, trackId, parameterIds, context });
    if (planned?.deviceType !== DEVICE_TYPE_IDS.bacteria || planned.frozen) {
        return null;
    }
    return planned;
}
