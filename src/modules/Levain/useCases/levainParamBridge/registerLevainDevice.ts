import { levainBridge } from './levainBridge';

import type { LevainDevice, LevainSampleLoadOutcome } from './helpers';

export function registerLevainDevice(
    deviceId: string,
    device: LevainDevice,
    port?: MessagePort
): Promise<LevainSampleLoadOutcome> {
    return levainBridge().registerLevainDevice(deviceId, device, port);
}
