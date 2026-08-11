import { BUILTIN_PLUGINS } from '../models/DeviceParameter';

export function getAutomationDeviceDescriptor(deviceType: string): (typeof BUILTIN_PLUGINS)[number] | undefined {
    const exactDescriptor = BUILTIN_PLUGINS.find((candidate) => candidate.id === deviceType);
    if (exactDescriptor) {
        return exactDescriptor;
    }

    const legacyName = deviceType.toLowerCase();
    return BUILTIN_PLUGINS.find((candidate) => candidate.name.toLowerCase() === legacyName);
}
