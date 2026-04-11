import { getAllTracks } from '#/modules/Arrangement/useCases';
export type DeviceRef = { trackId: string; deviceId: string };

export function createFindDeviceRef(getAllTracksFn: typeof getAllTracks) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}

export const findDeviceRef = createFindDeviceRef(getAllTracks);