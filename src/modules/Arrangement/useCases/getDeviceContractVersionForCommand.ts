import { getPluginById } from '../models/DeviceParameter';
import { getStableContractFingerprint } from '../models/GetStableContractFingerprint';

export function getDeviceContractVersionForCommand(deviceType: string): string | undefined {
    const descriptor = getPluginById(deviceType);
    if (!descriptor) {
        return undefined;
    }
    return `descriptor-v1:${getStableContractFingerprint(descriptor)}`;
}
