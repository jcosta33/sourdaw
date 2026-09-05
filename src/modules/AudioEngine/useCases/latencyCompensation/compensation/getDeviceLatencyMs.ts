import { getAudioContext } from '../../engineAccess/getAudioContext';

import { externalLatencyRegistry } from './externalLatencyRegistry';
import { deviceLatencyMap, WORKLET_BLOCK_SIZE } from './helpers';

const EXTERNAL_PLUGIN_DEVICE_TYPE = 'external-plugin';

type AudioContextLatencyShape = {
    sampleRate?: number;
};

function engineSampleRate(): number {
    const context: AudioContextLatencyShape = getAudioContext();
    return context.sampleRate ?? 48000;
}

/**
 * What one device costs the Web Audio graph, in milliseconds.
 *
 * An `external-plugin` device costs nothing (#3564). The native engine hosts
 * and sounds the plugin; what stands in its place in the Web Audio chain is a
 * unity gain pass-through, and a pass-through delays no sample. Neither the
 * plugin's own reported latency nor the bridge round trip belongs here any
 * more — both described audio that used to leave this process and come back,
 * and none does. Compensating for a delay the graph no longer has would push
 * every other device on the strip late by exactly that figure.
 *
 * The plugin's real latency is compensated where the plugin actually sounds:
 * the native engine aligns it against every route summing beside it, in frames
 * of the device's own clock. Reporting it here as well would compensate it
 * twice.
 */
export function getDeviceLatencyMs(deviceId: string, deviceType: string): number {
    if (deviceType === EXTERNAL_PLUGIN_DEVICE_TYPE) {
        return 0;
    }

    const reported = externalLatencyRegistry.get(deviceId);
    if (reported !== undefined) {
        return reported;
    }

    if (deviceType === 'builtin-sidechain-compressor') {
        return (WORKLET_BLOCK_SIZE / engineSampleRate()) * 1000;
    }

    return deviceLatencyMap[deviceType] ?? 0;
}
