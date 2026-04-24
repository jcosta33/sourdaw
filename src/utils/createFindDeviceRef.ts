import type { getAllTracks } from '#/modules/Arrangement/useCases';

export type DeviceRef = { trackId: string; deviceId: string };

export type GetAllTracksFn = typeof getAllTracks;

export function createFindDeviceRef(getAllTracksFn: GetAllTracksFn) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((device) => device.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}
