import { trackStore } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { type TrackLatency } from '../../../models/LatencyCompensationTypes';

import { getDeviceLatencyMs } from './getDeviceLatencyMs';

export function getTrackLatency(
    trackId: string,
    visited = new Set<string>(),
    omitDeviceTypes?: readonly string[]
): TrackLatency {
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
        if (device.bypassed) {
            continue;
        }
        // Omit applies only to this queried track's own device loop — never to
        // recursive downstream (output/sends/sidechain) totals. Freeze printed
        // this track's chain without those types; buses below were not printed.
        if (omitDeviceTypes?.includes(device.type)) {
            continue;
        }
        deviceLatencyMs += getDeviceLatencyMs(device.id, device.type);
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
