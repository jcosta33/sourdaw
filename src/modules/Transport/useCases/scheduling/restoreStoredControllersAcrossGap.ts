import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    listStoredControllerPostedDevices,
    storedControllerDeviceKey,
} from '../../services/storedControllerEngagement';

import { restoreStoredControllers, type RestoreStoredControllersInput } from './restoreStoredControllers';
import { createSameFramePostQueue } from './sameFramePostQueue';

type RestoreStoredControllersAcrossGapInput = Pick<
    RestoreStoredControllersInput,
    'trackId' | 'clips' | 'atBeat' | 'windowToBeat' | 'sampleFrameAtBeat'
> & { isCurrent: () => boolean };

/**
 * Run the track-level restore of a relocation for a track that has no clip playing
 * at the destination, and return the `storedControllerDeviceKey` of each device it
 * restored.
 *
 * A gap is not a reset: continuous playback keeps a pedal the clips before it left
 * down, so what the destination holds is what those clips left, the same carry a
 * destination inside a clip gets, and only a pedal stored playback moved that no
 * earlier clip left a value for is lifted. The devices are the ones stored playback
 * already posted to, because a track with no clip at the destination has no window
 * to say which instrument its stored controllers play on.
 */
export function restoreStoredControllersAcrossGap({
    trackId,
    clips,
    atBeat,
    windowToBeat,
    sampleFrameAtBeat,
    isCurrent,
}: RestoreStoredControllersAcrossGapInput): string[] {
    const restored: string[] = [];
    for (const device of listStoredControllerPostedDevices()) {
        if (device.trackId !== trackId) {
            continue;
        }
        const node = getTrackStrip(trackId)?.deviceNodes.find((candidate) => candidate.deviceId === device.deviceId);
        if (!node) {
            continue;
        }
        const queue = createSameFramePostQueue();
        restoreStoredControllers({
            trackId,
            device: { id: device.deviceId, type: device.deviceType },
            node,
            clips,
            atBeat,
            windowToBeat,
            sampleFrameAtBeat,
            queue,
        });
        queue.flush(isCurrent);
        restored.push(storedControllerDeviceKey(trackId, device.deviceId));
    }
    return restored;
}
