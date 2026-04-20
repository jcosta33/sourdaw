import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { type TrackLatency } from '../../../models/LatencyCompensationTypes';
import { audioEngine } from '../../../repositories/createWebAudioEngine';

export const WORKLET_BLOCK_SIZE = 128;

export const deviceLatencyMap: Record<string, number> = {
    'builtin-eq': 0,
    'builtin-compressor': 0,
    'builtin-reverb': 0,
    'builtin-delay': 0,
    'builtin-gain': 0,
    'builtin-sidechain-compressor': (WORKLET_BLOCK_SIZE / 48000) * 1000,
};

export const externalLatencyRegistry = new Map<string, number>();

export function getDeviceLatencyMs(deviceType: string): number {
    const external = externalLatencyRegistry.get(deviceType);
    if (external !== undefined) {
        return external;
    }

    const sampleRate = audioEngine.context.sampleRate;
    if (deviceType === 'builtin-sidechain-compressor') {
        return (WORKLET_BLOCK_SIZE / sampleRate) * 1000;
    }

    return deviceLatencyMap[deviceType] ?? 0;
}

export function getTrackLatency(trackId: string, visited = new Set<string>()): TrackLatency {
    const state = getTrackStoreState();
    if (!state) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || visited.has(trackId)) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    visited.add(trackId);

    let deviceLatencyMs = 0;
    for (const device of track.devices) {
        if (!device.bypassed) {
            deviceLatencyMs += getDeviceLatencyMs(device.type);
        }
    }

    let maxDownstreamMs = 0;

    if (track.outputId && track.outputId !== 'hw_out') {
        const outLatency = getTrackLatency(track.outputId, visited);
        maxDownstreamMs = Math.max(maxDownstreamMs, outLatency.totalLatencyMs);
    }

    for (const send of track.sends) {
        const sendLatency = getTrackLatency(send.busId, visited);
        maxDownstreamMs = Math.max(maxDownstreamMs, sendLatency.totalLatencyMs);
    }

    visited.delete(trackId);

    return { trackId, deviceLatencyMs, totalLatencyMs: deviceLatencyMs + maxDownstreamMs };
}

export function getMaxTrackLatency(): number {
    const state = getTrackStoreState();
    if (!state) {
        return 0;
    }

    let maxMs = 0;
    for (const track of state.tracks) {
        const latency = getTrackLatency(track.id);
        if (latency.totalLatencyMs > maxMs) {
            maxMs = latency.totalLatencyMs;
        }
    }

    return maxMs;
}
