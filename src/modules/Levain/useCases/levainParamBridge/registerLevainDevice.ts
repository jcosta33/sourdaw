import type { LevainDevice } from './helpers';
import { levainBridge } from './levainBridge';

export const registerLevainDevice = (device: LevainDevice, port?: MessagePort): void => {
    levainBridge().registerLevainDevice(device, port);
};