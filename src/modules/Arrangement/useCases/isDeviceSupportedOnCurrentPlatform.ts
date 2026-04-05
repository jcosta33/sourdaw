import { isDeviceSupportedOnCurrentPlatform as modelIsDeviceSupportedOnCurrentPlatform } from '../models/DeviceParameter';

export function isDeviceSupportedOnCurrentPlatform(deviceType: string): boolean {
    return modelIsDeviceSupportedOnCurrentPlatform(deviceType);
}
