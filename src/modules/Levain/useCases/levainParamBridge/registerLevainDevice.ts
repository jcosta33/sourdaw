import { levainBridge } from './levainBridge';

import type { LevainDevice } from './helpers';

export function registerLevainDevice(
    deviceId: string,
    device: LevainDevice,
    port?: MessagePort,
    onContentLoadSettled?: (outcome: 'ready' | 'failed' | 'cancelled') => void
): void {
    if (onContentLoadSettled) {
        levainBridge().registerLevainDevice(deviceId, device, port, onContentLoadSettled);
        return;
    }
    levainBridge().registerLevainDevice(deviceId, device, port);
}
