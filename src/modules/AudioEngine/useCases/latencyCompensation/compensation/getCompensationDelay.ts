import { getMaxTrackLatency } from './getMaxTrackLatency';
import { getTrackLatency } from './getTrackLatency';

export function getCompensationDelay(trackId: string, omitDeviceTypes?: readonly string[]): number {
    // Session max stays live (including every device type). Omit only shrinks
    // the queried track's own loop so freeze can pin the delay that matches a
    // printed buffer that withheld those types.
    const maxLatencyMs = getMaxTrackLatency();
    const trackLatency = getTrackLatency(trackId, new Set(), omitDeviceTypes);
    return (maxLatencyMs - trackLatency.totalLatencyMs) / 1000;
}
