import { deepestHostedLatencyMs } from '../latencyCompensation/compensation/deepestHostedLatencyMs';
import { getMaxTrackLatency } from '../latencyCompensation/compensation/getMaxTrackLatency';
import { type LatencyCompensationInput } from '../latencyCompensation/compensation/LatencyCompensationInput';

/**
 * Frames the native programme delays its whole master by before the engine's
 * own hold: the session depth less the depth the engine already holds every
 * route to (`getCompensationDelay` with the hosted set). The engine's own
 * depth includes hosted plugin latency this side cannot see, so the engine
 * trims that part itself.
 */
export function nativeProgrammeHeadFrames(
    latency: LatencyCompensationInput,
    engineHostedStripIds: ReadonlySet<string>,
    sampleRate: number
): number {
    const headMs = Math.max(0, getMaxTrackLatency(latency) - deepestHostedLatencyMs(engineHostedStripIds, latency));
    return Math.round((headMs / 1000) * sampleRate);
}
