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
    const track = state.tracks.find((t) => t.devices.some((d) => d.id === deviceId));
    if (!track) {
        return;
    }
    updateTrack(track.id, (t) => ({
        ...t,
        devices: t.devices.map((d) =>
            d.id === deviceId ? { ...d, parameterValues: { ...d.parameterValues, [paramId]: value } } : d
        ),
    }));
}
