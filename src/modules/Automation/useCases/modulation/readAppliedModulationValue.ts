import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { appliedModulationValues } from './modulationSlewState';

export function readAppliedModulationValue(trackId: string, deviceId: string, parameterId: string): number | undefined {
    const owner = resolveEligibleDeviceWriteTarget(deviceId);
    if (owner.status !== 'eligible' || owner.trackId !== trackId) {
        return undefined;
    }
    return appliedModulationValues.get(`${trackId} ${deviceId} ${parameterId}`);
}
