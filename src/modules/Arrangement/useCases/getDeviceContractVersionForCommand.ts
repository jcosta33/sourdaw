import { getPluginById, type PluginDescriptor } from '../models/DeviceParameter';
import { getStableContractFingerprint } from '../models/GetStableContractFingerprint';

function getCommandReplayDescriptorProjection({
    characterTags: _characterTags,
    ...commandReplayDescriptor
}: PluginDescriptor): Omit<PluginDescriptor, 'characterTags'> {
    return commandReplayDescriptor;
}

export function getDeviceContractVersionForCommand(deviceType: string): string | undefined {
    const descriptor = getPluginById(deviceType);
    if (!descriptor) {
        return undefined;
    }
    return `descriptor-v1:${getStableContractFingerprint(getCommandReplayDescriptorProjection(descriptor))}`;
}
