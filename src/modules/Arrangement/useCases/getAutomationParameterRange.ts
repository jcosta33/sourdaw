import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { isDeviceParameterAutomatable } from '../models/DeviceParameterLaw';

import { getAutomationDeviceDescriptor } from './getAutomationDeviceDescriptor';
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
        (device, candidateParameterId) => {
            const descriptor = getAutomationDeviceDescriptor(device.type);
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

    const parameter = getAutomationDeviceDescriptor(device.type)?.parameters.find(
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
