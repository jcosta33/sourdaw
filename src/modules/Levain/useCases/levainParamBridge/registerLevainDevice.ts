import { levainBridge } from './levainBridge';

import type { LevainDevice } from './helpers';

export const registerLevainDevice = (device: LevainDevice, port?: MessagePort): void => {
    levainBridge().registerLevainDevice(device, port);
};
