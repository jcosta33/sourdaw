import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';

import { GLUTEN_PRESET_PARAMETER_ORDER } from '../models/GlutenPresetParameterOrder';

export function readGlutenFactoryPresetTarget(deviceId: string) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return null;
    }
    const owner = getPlannedDevicePatchState({
        trackId: target.trackId,
        deviceId,
        parameterIds: GLUTEN_PRESET_PARAMETER_ORDER,
    });
    return owner?.deviceType === 'gluten' && !owner.frozen ? owner : null;
}
