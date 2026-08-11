import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { BUILTIN_PLUGINS } from '../models/DeviceParameter';
import { isDeviceParameterAutomatable } from '../models/DeviceParameterLaw';

import { getTrackById } from './getTrackById';

type GetAutomationParameterRangeInput = {
    trackId: string;
    parameterTargetId: string;
};

export function getAutomationParameterRange({
    trackId,
    parameterTargetId,
}: GetAutomationParameterRangeInput): { minValue: number; maxValue: number } | null {
    const track = getTrackById(trackId);
    const parameterId = getDeviceAutomationParameterId(parameterTargetId);
    if (!track || !parameterId) {
        return null;
    }

    const deviceIndex = resolveDeviceAutomationTargetIndex(
        parameterTargetId,
        track.devices,
        (device, candidateParameterId) =>
            isDeviceParameterAutomatable({ deviceType: device.type, paramId: candidateParameterId })
    );
    const device = track.devices[deviceIndex];
    if (!device) {
        return null;
    }

    const parameter = BUILTIN_PLUGINS.find((plugin) => plugin.id === device.type)?.parameters.find(
        (candidate) => candidate.id === parameterId
    );
    if (
        !parameter ||
        !Number.isFinite(parameter.minValue) ||
        !Number.isFinite(parameter.maxValue) ||
        parameter.maxValue <= parameter.minValue
    ) {
        return null;
    }

    return { minValue: parameter.minValue, maxValue: parameter.maxValue };
}
