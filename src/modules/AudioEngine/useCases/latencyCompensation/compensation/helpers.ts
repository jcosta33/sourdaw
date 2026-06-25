import { trackStore } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { type TrackLatency } from '../../../models/LatencyCompensationTypes';
import { getAudioContext } from '../../engineAccess/getAudioContext';

import { externalLatencyRegistry } from './externalLatencyRegistry';

export const WORKLET_BLOCK_SIZE = 128;

export const deviceLatencyMap: Record<string, number> = {
    'builtin-eq': 0,
    'builtin-compressor': 0,
    'builtin-reverb': 0,
    'builtin-delay': 0,
    'builtin-gain': 0,
    'builtin-sidechain-compressor': (WORKLET_BLOCK_SIZE / 48000) * 1000,
};

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

export function getTrackLatency(trackId: string, visited = new Set<string>()): TrackLatency {
    const state = trackStore.value;
    if (!state) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || visited.has(trackId)) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    visited.add(trackId);

    let deviceLatencyMs = 0;
    for (const device of track.devices) {
        if (!device.bypassed) {
            deviceLatencyMs += getDeviceLatencyMs(device.id, device.type);
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

    // Sidechain routes feed this track's signal into a downstream target's
    // sidechain input (source -> target, mirroring sends/output). The target's
    // processing latency is therefore downstream of this track and must be
    // folded in, or PDC drifts on sidechain pumping mixes.
    const sidechainRoutes = sidechainStore.value?.routes ?? [];
    for (const route of sidechainRoutes) {
        if (route.sourceTrackId !== trackId) {
            continue;
        }
        const targetLatency = getTrackLatency(route.targetTrackId, visited);
        maxDownstreamMs = Math.max(maxDownstreamMs, targetLatency.totalLatencyMs);
    }

    visited.delete(trackId);

    return { trackId, deviceLatencyMs, totalLatencyMs: deviceLatencyMs + maxDownstreamMs };
}

export function getMaxTrackLatency(): number {
    const state = trackStore.value;
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
