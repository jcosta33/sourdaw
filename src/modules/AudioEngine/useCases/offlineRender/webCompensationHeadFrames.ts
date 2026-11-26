import { getMaxTrackLatency } from '../latencyCompensation/compensation/getMaxTrackLatency';
import { type LatencyCompensationInput } from '../latencyCompensation/compensation/LatencyCompensationInput';

/**
 * Frames the Web Audio render prints its whole master late by: every strip is
 * held up to the session's deepest latency (`getCompensationDelay`), so
 * timeline zero reaches the master that far into the render.
 */
export function webCompensationHeadFrames(latency: LatencyCompensationInput, sampleRate: number): number {
    return Math.round((getMaxTrackLatency(latency) / 1000) * sampleRate);
}
