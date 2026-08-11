import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { BUILTIN_PLUGINS } from '../models/DeviceParameter';
import { isDeviceParameterAutomatable } from '../models/DeviceParameterLaw';

import { getTrackById } from './getTrackById';

type GetAutomationParameterRangeInput = {
    trackId: string;
    parameterTargetId: string;
};

function findAutomationDeviceDescriptor(deviceType: string): (typeof BUILTIN_PLUGINS)[number] | undefined {
    const exactDescriptor = BUILTIN_PLUGINS.find((candidate) => candidate.id === deviceType);
    if (exactDescriptor) {
        return exactDescriptor;
    }

    const legacyName = deviceType.toLowerCase();
    return BUILTIN_PLUGINS.find((candidate) => candidate.name.toLowerCase() === legacyName);
}

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
        (device, candidateParameterId) => {
            const descriptor = findAutomationDeviceDescriptor(device.type);
            return isDeviceParameterAutomatable({
                deviceType: descriptor?.id ?? device.type,
                paramId: candidateParameterId,
            });
        }
    );
    const device = track.devices[deviceIndex];
    if (!device) {
        return null;
    }

    const parameter = findAutomationDeviceDescriptor(device.type)?.parameters.find(
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
