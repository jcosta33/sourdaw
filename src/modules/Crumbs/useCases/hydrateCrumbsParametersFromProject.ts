import { getEligibleDeviceParameterValues } from '#/modules/Arrangement/useCases';

import { replaceCrumbsProjectParameters } from '../stores/crumbsStore';

export function hydrateCrumbsParametersFromProject(deviceId: string): void {
    const parameterValues = getEligibleDeviceParameterValues(deviceId);
    if (!parameterValues) {
        return;
    }
    replaceCrumbsProjectParameters(deviceId, parameterValues);
}
