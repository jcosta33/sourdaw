import { getAudioContext } from '../../engineAccess/getAudioContext';

import { externalBridgeRoundTripFrames, externalLatencyRegistry } from './externalLatencyRegistry';
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
 * What the audio bridge adds for one external-plugin device, on top of the
 * latency the plugin reports for itself.
 *
 * A bridged plugin's audio leaves this process, waits in the native host's
 * ring for the audio callback, is processed, and waits again for the relay to
 * collect it. None of that is in the plugin's own figure, so a track hosting
 * one used to run audibly late against every compensated built-in beside it.
 * The frames are the host's own measurement of that round trip; the rate is the
 * engine rate the plugin was activated with, which is this context's.
 *
 * Temporary, with the bridge: jcosta33/sourdaw#2230 replaces the worklet relay
 * with the native graph, and this contribution goes with it.
 */
function getBridgeRoundTripMs(deviceId: string): number {
    const frames = externalBridgeRoundTripFrames.get(deviceId);
    if (frames === undefined || frames <= 0) {
        return 0;
    }
    return (frames / engineSampleRate()) * 1000;
}

export function getDeviceLatencyMs(deviceId: string, deviceType: string): number {
    const reported = externalLatencyRegistry.get(deviceId);

    if (deviceType === EXTERNAL_PLUGIN_DEVICE_TYPE) {
        return (reported ?? 0) + getBridgeRoundTripMs(deviceId);
    }

    if (reported !== undefined) {
        return reported;
    }

    if (deviceType === 'builtin-sidechain-compressor') {
        return (WORKLET_BLOCK_SIZE / engineSampleRate()) * 1000;
    }

    return deviceLatencyMap[deviceType] ?? 0;
}
