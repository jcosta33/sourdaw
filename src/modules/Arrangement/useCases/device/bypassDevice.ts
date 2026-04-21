import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function bypassDevice(deviceId: string, bypassed: boolean): void {
    const state = getTrackState();
    if (state) {
        for (const track of state.tracks) {
            if (track.devices.some((data) => data.id === deviceId)) {
                // Forward bypass to live engine for native DSP devices
                import('#/modules/AudioEngine/useCases')
                    .then(({ updateDeviceBypass }) => {
                        updateDeviceBypass(track.id, deviceId, bypassed);
                    })
                    .catch(() => {
                        // Engine bypass forwarding is best-effort
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
