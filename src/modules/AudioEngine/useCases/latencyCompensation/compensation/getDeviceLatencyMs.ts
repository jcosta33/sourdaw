import { getAudioContext } from '../../engineAccess/getAudioContext';

import { externalLatencyRegistry } from './externalLatencyRegistry';
import { deviceLatencyMap, WORKLET_BLOCK_SIZE } from './helpers';

export function getDeviceLatencyMs(deviceId: string, deviceType: string): number {
    const external = externalLatencyRegistry.get(deviceId);
    if (external !== undefined) {
        return external;
    }

    const context = getAudioContext();
    const sampleRate = context?.sampleRate ?? 48000;
    if (deviceType === 'builtin-sidechain-compressor') {
        return (WORKLET_BLOCK_SIZE / sampleRate) * 1000;
    }

    return deviceLatencyMap[deviceType] ?? 0;
}
