import { trackStore } from '#/modules/Arrangement/stores';

import { getTrackLatency } from './getTrackLatency';

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
