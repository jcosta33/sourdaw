import { getTrackState } from '../../../repositories/track/getTrackState';
import { updateTrack } from '../../../repositories/track/updateTrack';

export function persistDeviceParam(deviceId: string, paramId: string, value: number): void {
    if (!Number.isFinite(value)) {
        return;
    }
    const state = getTrackState();
    if (!state) {
        return;
    }
    const track = state.tracks.find((time) => time.devices.some((data) => data.id === deviceId));
    if (!track) {
        return;
    }
    updateTrack(track.id, (time) => ({
        ...time,
        devices: time.devices.map((data) =>
            data.id === deviceId ? { ...data, parameterValues: { ...data.parameterValues, [paramId]: value } } : data
        ),
    }));
}
