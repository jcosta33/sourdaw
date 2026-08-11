import { getEligibleDeviceParameterValues } from '#/modules/Arrangement/useCases';

import { replaceGrinderProjectParameters } from '../stores/grinderStore';

export function hydrateGrinderPatchFromProject(deviceId: string): void {
    const parameterValues = getEligibleDeviceParameterValues(deviceId);
    if (!parameterValues) {
        return;
    }
    replaceGrinderProjectParameters(deviceId, parameterValues);
}
