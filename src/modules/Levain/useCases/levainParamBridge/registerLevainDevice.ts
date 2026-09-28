import { levainBridge } from './levainBridge';

import type { LevainDevice, LevainSampleLoadOutcome } from './helpers';

export function registerLevainDevice(
    deviceId: string,
    device: LevainDevice,
    port?: MessagePort,
    onProgress?: (epoch: number, progress: number) => void
): Promise<LevainSampleLoadOutcome> {
    return levainBridge().registerLevainDevice(deviceId, device, port, onProgress);
}
