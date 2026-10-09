import { levainBridge } from './levainBridge';

export const unregisterLevainDevice = (deviceId: string, port: MessagePort): void => {
    levainBridge().unregisterLevainDevice(deviceId, port);
};
