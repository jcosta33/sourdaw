import { levainBridge } from './levainBridge';

import type { LevainDevice } from './helpers';

export function registerLevainDevice(device: LevainDevice, port?: MessagePort): void {
    levainBridge().registerLevainDevice(device, port);
}
