import { levainBridge } from './levainBridge';

import type { LevainDevice } from './helpers';

export const registerLevainDevice = (deviceId: string, device: LevainDevice, port?: MessagePort): void => {
    levainBridge().registerLevainDevice(deviceId, device, port);
};
