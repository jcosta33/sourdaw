import { trackStore } from '#/modules/Arrangement/stores';

import { getTrackLatency } from './getTrackLatency';
import { type LatencyCompensationInput } from './LatencyCompensationInput';

export function getMaxTrackLatency(input?: LatencyCompensationInput): number {
    const state = input ? { tracks: input.tracks } : trackStore.value;
    if (!state) {
        return 0;
    }

    let maxMs = 0;
    for (const track of state.tracks) {
        const latency = getTrackLatency(track.id, new Set(), undefined, undefined, input);
        if (latency.totalLatencyMs > maxMs) {
            maxMs = latency.totalLatencyMs;
        }
    }

    return maxMs;
}
