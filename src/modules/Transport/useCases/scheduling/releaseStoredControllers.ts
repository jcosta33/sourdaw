import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    storedControllerDeviceKey,
    takeStoredControllerEngagements,
    takeStoredControllerPostedDevices,
} from '../../services/storedControllerEngagement';

import { discardStoredMoves } from './discardStoredMoves';
import { releaseStoredEngagement } from './releaseStoredEngagement';

type DeviceRelease = { trackId: string; deviceId: string; deviceType: string; pedals: Set<number> };

/**
 * End stored playback's hold on the instruments: drop the stored moves still queued
 * for a frame that will not come, then lift every pedal stored playback moved, on
 * exactly the devices it posted to.
 *
 * Dropping first matters: a lift, or a Levain CC11 move, posted for the look-ahead
 * past the position playback is leaving would otherwise apply after this, over the
 * destination's restore or after the stop. Once the queued moves are gone the
 * engine's pedal is wherever the last applied move left it, which the record of
 * posted moves cannot tell, so every pedal stored playback moved is lifted (the
 * restore of a relocation presses it again where a lane says so). A controller
 * that is not a pedal (CC1, CC7, CC11) keeps the value it last applied.
 *
 * A device stored playback never posted to is in no record and gets nothing, so a
 * pedal or controller the user holds live is left alone; the lifts apply at once
 * and, being stored moves, supersede nothing a performer queued.
 */
export function releaseStoredControllers(): void {
    const devices = new Map<string, DeviceRelease>();
    for (const posted of takeStoredControllerPostedDevices()) {
        devices.set(storedControllerDeviceKey(posted.trackId, posted.deviceId), posted);
    }
    for (const engaged of takeStoredControllerEngagements()) {
        const key = storedControllerDeviceKey(engaged.trackId, engaged.deviceId);
        const device = devices.get(key) ?? { ...engaged, pedals: new Set<number>() };
        for (const controller of engaged.controllers) {
            device.pedals.add(controller);
        }
        devices.set(key, device);
    }
    for (const device of devices.values()) {
        const node = getTrackStrip(device.trackId)?.deviceNodes.find(
            (candidate) => candidate.deviceId === device.deviceId
        );
        if (!node) {
            continue;
        }
        discardStoredMoves(device.deviceType, node);
        releaseStoredEngagement({ deviceType: device.deviceType, node, controllers: device.pedals });
    }
}
