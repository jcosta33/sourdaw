import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { getTrackEligibility } from '../../stores/trackEligibility';

export function bypassDevice(deviceId: string, bypassed: boolean): void {
    const state = getTrackState();
    if (state) {
        for (const track of state.tracks) {
            if (track.devices.some((data) => data.id === deviceId)) {
                if (!getTrackEligibility(track.kind).acceptsDeviceUpdate) {
                    return;
                }
                // Forward bypass to live engine for native DSP devices
                import('#/modules/AudioEngine/useCases')
                    .then(({ updateDeviceBypass }) => {
                        updateDeviceBypass(track.id, deviceId, bypassed);
                        return null;
                    })
                    .catch(() => {
                        // Engine bypass forwarding is best-effort
                        return null;
                    });
                break;
            }
        }
    }

    mapAllTracks((time) => ({
        ...time,
        devices: time.devices.map((data) => (data.id === deviceId ? { ...data, bypassed } : data)),
    }));
}
