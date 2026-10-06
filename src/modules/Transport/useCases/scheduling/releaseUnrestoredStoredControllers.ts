import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    listStoredControllerEngagements,
    noteStoredControllerMove,
    storedControllerDeviceKey,
} from '../../services/storedControllerEngagement';

import { releaseStoredEngagement } from './releaseStoredEngagement';

type ReleaseUnrestoredStoredControllersInput = {
    /** `storedControllerDeviceKey`s of the devices this relocation already restored. */
    restored: ReadonlySet<string>;
    /** The sample frame the relocation lands at on one track's clock. */
    sampleFrameOnTrack: (trackId: string) => number;
};

/**
 * Release, at the relocation's frame, every controller stored playback left
 * engaged on a device the relocation did not restore.
 *
 * A device is restored only when its track has a clip of this window to restore
 * it from. A track with no clip at the destination, or one that is muted or frozen
 * there, still holds the pedal the last pass left down, and nothing else would
 * lift it before the next stop.
 */
export function releaseUnrestoredStoredControllers({
    restored,
    sampleFrameOnTrack,
}: ReleaseUnrestoredStoredControllersInput): void {
    for (const engagement of listStoredControllerEngagements()) {
        if (restored.has(storedControllerDeviceKey(engagement.trackId, engagement.deviceId))) {
            continue;
        }
        const node = getTrackStrip(engagement.trackId)?.deviceNodes.find(
            (candidate) => candidate.deviceId === engagement.deviceId
        );
        if (!node) {
            continue;
        }
        releaseStoredEngagement({
            deviceType: engagement.deviceType,
            node,
            controllers: engagement.controllers,
            sampleFrame: sampleFrameOnTrack(engagement.trackId),
        });
        for (const controller of engagement.controllers) {
            noteStoredControllerMove({
                trackId: engagement.trackId,
                deviceId: engagement.deviceId,
                deviceType: engagement.deviceType,
                controller,
                engaged: false,
            });
        }
    }
}
