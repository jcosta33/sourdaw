export type DeviceRef = { trackId: string; deviceId: string };

type TrackLike = { id: string; devices: ReadonlyArray<{ id: string }> };

export type GetAllTracksFn = () => ReadonlyArray<TrackLike>;

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
