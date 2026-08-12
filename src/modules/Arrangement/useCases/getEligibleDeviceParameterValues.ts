import { clampDeviceParameterValue } from '../models/DeviceParameterLaw';
import { resolveEligibleDeviceWriteTarget } from '../stores/resolveEligibleDeviceWriteTarget';
import { trackStore } from '../stores/trackStore';

export function getEligibleDeviceParameterValues(deviceId: string): Record<string, number> | null {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return null;
    }

    const device = trackStore.value?.tracks
        .find((track) => track.id === target.trackId)
        ?.devices.find((entry) => entry.id === target.deviceId);
    if (!device) {
        return null;
    }

    const clampedValues: Record<string, number> = {};
    for (const [paramId, value] of Object.entries(device.parameterValues)) {
        if (!Number.isFinite(value)) {
            continue;
        }
        const identity = { deviceType: device.type, paramId, value };
        clampedValues[paramId] = clampDeviceParameterValue(identity);
    }
    return clampedValues;
}
