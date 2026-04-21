import { getTrackState } from '../../../repositories/track/getTrackState';
import { updateTrack } from '../../../repositories/track/updateTrack';

export function persistDevicePatch(deviceId: string, patch: Record<string, unknown>): void {
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
        devices: time.devices.map((data) => {
            if (data.id !== deviceId) {
                return data;
            }

            const parameterValues = { ...data.parameterValues };
            for (const [key, value] of Object.entries(patch)) {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    parameterValues[key] = value;
                }
            }

            return { ...data, parameterValues };
        }),
    }));
}
