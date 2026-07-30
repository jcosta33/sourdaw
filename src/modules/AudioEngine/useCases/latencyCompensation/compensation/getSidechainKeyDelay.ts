import { captureLatencyCompensationSnapshot } from './captureLatencyCompensationSnapshot';

export type GetSidechainKeyDelayInput = {
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
};

/**
 * FX-5 — seconds of delay the sidechain key needs so it lands on the detector
 * at the same instant as the program signal it is judging.
 *
 * The key is tapped post-fader off the source strip, so by the time it reaches
 * the detector it carries the source track's PDC shift plus its whole device
 * chain. The program arriving on the detector's main input carries the *target*
 * track's PDC shift plus only the devices sitting upstream of the detector.
 * Aligning the two is the difference:
 *
 *     keyDelay = (comp(target) + upstreamOf(detector)) − (comp(source) + chain(source))
 *
 * Every term comes off the same latency snapshot surface the offline path uses,
 * so live and export agree by construction. Standalone reads capture current
 * state; the live scheduler shares one immutable snapshot across each tick, so
 * a mid-session latency push moves the alignment within one grain.
 *
 * A negative result means the key already arrives later than the program, which
 * a delay line cannot undo; it clamps to zero rather than widening the error.
 */
export function getSidechainKeyDelay({
    sourceTrackId,
    targetTrackId,
    targetDeviceId,
}: GetSidechainKeyDelayInput): number {
    return captureLatencyCompensationSnapshot().getSidechainKeyDelay({
        sourceTrackId,
        targetTrackId,
        targetDeviceId,
    });
}
