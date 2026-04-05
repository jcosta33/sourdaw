import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { type TrackLatency, type LatencyReport } from '#/modules/AudioEngine/models/LatencyCompensationTypes';

const WORKLET_BLOCK_SIZE = 128;

const deviceLatencyMap: Record<string, number> = {
    'builtin-eq': 0,
    'builtin-compressor': 0,
    'builtin-reverb': 0,
    'builtin-delay': 0,
    'builtin-gain': 0,
    'builtin-sidechain-compressor': (WORKLET_BLOCK_SIZE / 48000) * 1000,
};

const externalLatencyRegistry = new Map<string, number>();

export function reportLatency(deviceType: string, latencyMs: number): void {
    externalLatencyRegistry.set(deviceType, latencyMs);
}

export function clearReportedLatency(deviceType: string): void {
    externalLatencyRegistry.delete(deviceType);
}

function getDeviceLatencyMs(deviceType: string): number {
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

export function getTrackLatency(trackId: string): TrackLatency {
    const state = getTrackStoreState();
    if (!state) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    let deviceLatencyMs = 0;
    for (const device of track.devices) {
        if (!device.bypassed) {
            deviceLatencyMs += getDeviceLatencyMs(device.type);
        }
    }

    return { trackId, deviceLatencyMs, totalLatencyMs: deviceLatencyMs };
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

export function getCompensationDelay(trackId: string): number {
    const maxLatencyMs = getMaxTrackLatency();
    const trackLatency = getTrackLatency(trackId);
    return (maxLatencyMs - trackLatency.totalLatencyMs) / 1000;
}

export function getLatencyReport(): LatencyReport {
    const state = getTrackStoreState();
    const tracks: TrackLatency[] = [];

    if (state) {
        for (const track of state.tracks) {
            tracks.push(getTrackLatency(track.id));
        }
    }

    const ctx = audioEngine.context;

    return {
        tracks,
        maxLatencyMs: getMaxTrackLatency(),
        contextBaseLatencyMs: (ctx.baseLatency ?? 0) * 1000,
        contextOutputLatencyMs:
            ('outputLatency' in ctx ? (ctx as unknown as { outputLatency: number }).outputLatency : 0) * 1000,
    };
}
