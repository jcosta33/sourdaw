import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    listStoredControllerPostedDevices,
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
 * Lift, at the relocation's frame, every pedal stored playback moved on a device the
 * relocation did not restore.
 *
 * A device is restored when its track plays at the relocation, with a clip at the
 * destination or across a gap, and the scheduler routes its stored controllers to the
 * device. A track that is muted or frozen there does not play, and a device the scheduler
 * no longer routes to (a Yeast, drum-kit or Toaster track, or one with no instrument node)
 * is posted to by nothing, so nothing is in force for any pedal, and it still holds the
 * pedal the last pass left down, which nothing else would lift before the next stop.
 */
export function releaseUnrestoredStoredControllers({
    restored,
    sampleFrameOnTrack,
}: ReleaseUnrestoredStoredControllersInput): void {
    for (const device of listStoredControllerPostedDevices()) {
        if (device.pedals.size === 0 || restored.has(storedControllerDeviceKey(device.trackId, device.deviceId))) {
            continue;
        }
        const node = getTrackStrip(device.trackId)?.deviceNodes.find(
            (candidate) => candidate.deviceId === device.deviceId
        );
        if (!node) {
            continue;
        }
        releaseStoredEngagement({
            deviceType: device.deviceType,
            node,
            controllers: device.pedals,
            sampleFrame: sampleFrameOnTrack(device.trackId),
        });
        for (const controller of device.pedals) {
            noteStoredControllerMove({
                trackId: device.trackId,
                deviceId: device.deviceId,
                deviceType: device.deviceType,
                controller,
                engaged: false,
            });
        }
    }
}
