import { getAudioContext } from '../../engineAccess/getAudioContext';

import { externalLatencyRegistry } from './externalLatencyRegistry';
import { deviceLatencyMap, WORKLET_BLOCK_SIZE } from './helpers';

type AudioContextLatencyShape = {
    sampleRate?: number;
};

export function getDeviceLatencyMs(deviceId: string, deviceType: string, capturedSampleRate?: number): number {
    const external = externalLatencyRegistry.get(deviceId);
    if (external !== undefined) {
        return external;
    }

    let sampleRate = capturedSampleRate;
    if (sampleRate === undefined) {
        const context: AudioContextLatencyShape = getAudioContext();
        sampleRate = context.sampleRate ?? 48000;
    }
    if (deviceType === 'builtin-sidechain-compressor') {
        return (WORKLET_BLOCK_SIZE / sampleRate) * 1000;
    }

    return deviceLatencyMap[deviceType] ?? 0;
}
