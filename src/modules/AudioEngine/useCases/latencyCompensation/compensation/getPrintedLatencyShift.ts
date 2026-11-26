import { getCompensationDelay } from './getCompensationDelay';
import { getTrackLatency } from './getTrackLatency';
import { type LatencyCompensationInput } from './LatencyCompensationInput';

/**
 * How far an offline print of one strip's output sits after its timeline
 * position, in seconds: the delay compensation holds the strip back by, plus the
 * latency of its own devices, which the print carries as real samples.
 *
 * The compensation is the strip's full-chain figure, because that is the delay
 * the strip is scheduled with whatever the print keeps. The device term counts
 * only what the print carries: `unprintedDeviceTypes` names the types a render
 * leaves out of the strip it builds. With none left out the shift equals the
 * session depth minus what lies downstream of the strip.
 */
export function getPrintedLatencyShift(
    trackId: string,
    input?: LatencyCompensationInput,
    unprintedDeviceTypes?: readonly string[]
): number {
    const compensationSeconds = getCompensationDelay(trackId, undefined, undefined, input);
    const { deviceLatencyMs } = getTrackLatency(trackId, new Set(), unprintedDeviceTypes, undefined, input);
    return compensationSeconds + deviceLatencyMs / 1000;
}
