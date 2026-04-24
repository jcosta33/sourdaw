import { levainBridge } from './levainBridge';

export const unregisterLevainDevice = (deviceId: string): void => {
    levainBridge().unregisterLevainDevice(deviceId);
};
