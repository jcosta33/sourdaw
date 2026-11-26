import { getCompensationDelay } from './getCompensationDelay';
import { getTrackLatency } from './getTrackLatency';
import { type LatencyCompensationInput } from './LatencyCompensationInput';

/**
 * How far an offline print of one strip's output sits after its timeline
 * position, in seconds: the delay compensation holds the strip back by, plus the
 * latency of its own devices, which the print carries as real samples.
 *
 * Equal to the session depth minus what lies downstream of the strip. It is the
 * exact figure when every device the strip holds is printed, and an upper bound
 * when a device the offline chain withholds still counts in its latency.
 */
export function getPrintedLatencyShift(trackId: string, input?: LatencyCompensationInput): number {
    const compensationSeconds = getCompensationDelay(trackId, undefined, undefined, input);
    const { deviceLatencyMs } = getTrackLatency(trackId, new Set(), undefined, undefined, input);
    return compensationSeconds + deviceLatencyMs / 1000;
}
