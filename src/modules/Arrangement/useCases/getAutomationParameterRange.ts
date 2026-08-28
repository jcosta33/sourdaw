import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { isDeviceParameterAutomatable } from '../models/DeviceParameterLaw';

import { acceptsExternalPluginAutomationParameter } from './acceptsExternalPluginAutomationParameter';
import { getAutomationDeviceDescriptor } from './getAutomationDeviceDescriptor';
import { getTrackById } from './getTrackById';

type GetAutomationParameterRangeInput = {
    trackId: string;
    parameterTargetId: string;
};

type AutomationTargetDevice = { type: string; externalInstanceId?: string };

/**
 * Whether a curve may drive this parameter on this device.
 *
 * An external plugin instance is held to the parameter list it published,
 * because the permissive "no declared contract" branch of
 * `isDeviceParameterAutomatable` would otherwise accept any id at all —
 * including one the plugin does not have.
 */
function acceptsAutomationParameter(device: AutomationTargetDevice, parameterId: string): boolean {
    if (device.externalInstanceId !== undefined) {
        return acceptsExternalPluginAutomationParameter(
            { type: device.type, externalInstanceId: device.externalInstanceId },
            parameterId
        );
    }

    const descriptor = getAutomationDeviceDescriptor(device.type);
    return isDeviceParameterAutomatable({ deviceType: descriptor?.id ?? device.type, paramId: parameterId });
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
        acceptsAutomationParameter
    );
    const device = track.devices[deviceIndex];
    if (!device) {
        return null;
    }

    const parameter = getAutomationDeviceDescriptor(device.type, device.externalInstanceId)?.parameters.find(
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
