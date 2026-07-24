import { trackStore } from '#/modules/Arrangement/stores';

import { getCompensationDelay } from './getCompensationDelay';
import { getDeviceLatencyMs } from './getDeviceLatencyMs';
import { getTrackLatency } from './getTrackLatency';

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
 * Every term comes off the one `getCompensationDelay` / `getDeviceLatencyMs`
 * surface the offline path uses, so live and export agree by construction and a
 * mid-session latency push moves the alignment on the next read (nothing here
 * caches — same discipline the native-plugin latency path is locked to).
 *
 * A negative result means the key already arrives later than the program, which
 * a delay line cannot undo; it clamps to zero rather than widening the error.
 */
export function getSidechainKeyDelay({
    sourceTrackId,
    targetTrackId,
    targetDeviceId,
}: GetSidechainKeyDelayInput): number {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return 0;
    }

    const targetTrack = tracks.find((track) => track.id === targetTrackId);
    if (!targetTrack) {
        return 0;
    }

    let upstreamOfDetectorMs = 0;
    for (const device of targetTrack.devices) {
        if (device.id === targetDeviceId) {
            break;
        }
        if (!device.bypassed) {
            upstreamOfDetectorMs += getDeviceLatencyMs(device.id, device.type);
        }
    }

    const keyChainMs = getTrackLatency(sourceTrackId).deviceLatencyMs;
    const programArrivalSec = getCompensationDelay(targetTrackId) + upstreamOfDetectorMs / 1000;
    const keyArrivalSec = getCompensationDelay(sourceTrackId) + keyChainMs / 1000;
    const alignmentSec = programArrivalSec - keyArrivalSec;

    if (alignmentSec <= 0) {
        return 0;
    }
    return alignmentSec;
}
