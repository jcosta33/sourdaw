import { updateDeviceBypass } from '#/modules/AudioEngine/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { getTrackEligibility } from '../../stores/trackEligibility';

export function bypassDevice(deviceId: string, bypassed: boolean): boolean {
    const state = getTrackState();
    if (state) {
        for (const track of state.tracks) {
            if (track.devices.some((data) => data.id === deviceId)) {
                if (!getTrackEligibility(track.kind).acceptsDeviceUpdate) {
                    return false;
                }
                updateDeviceBypass(track.id, deviceId, bypassed);
                break;
            }
        }
    }

    mapAllTracks((time) => ({
        ...time,
        devices: time.devices.map((data) => (data.id === deviceId ? { ...data, bypassed } : data)),
    }));
    return true;
}
