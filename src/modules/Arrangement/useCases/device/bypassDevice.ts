import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function bypassDevice(deviceId: string, bypassed: boolean): void {
    const state = getTrackState();
    if (state) {
        for (const track of state.tracks) {
            if (track.devices.some((d) => d.id === deviceId)) {
                // Forward bypass to live engine for native DSP devices
                import('#/modules/AudioEngine/useCases/deviceControls').then(({ updateDeviceBypass }) => {
                    updateDeviceBypass(track.id, deviceId, bypassed);
                }).catch(() => {
                    // Engine bypass forwarding is best-effort
                });
                break;
            }
        }
    }

    mapAllTracks((t) => ({
        ...t,
        devices: t.devices.map((d) => (d.id === deviceId ? { ...d, bypassed } : d)),
    }));
}
