import { getMaxTrackLatency, getTrackLatency } from './helpers';

export function getCompensationDelay(trackId: string): number {
    const maxLatencyMs = getMaxTrackLatency();
    const trackLatency = getTrackLatency(trackId);
    return (maxLatencyMs - trackLatency.totalLatencyMs) / 1000;
}
