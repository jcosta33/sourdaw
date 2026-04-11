import { getAllTracks, persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
export type DeviceRef = { trackId: string; deviceId: string };
export type GetAllTracksFn = typeof getAllTracks;
export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;

export function createFindDeviceRef(getAllTracksFn: GetAllTracksFn) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}