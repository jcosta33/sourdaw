import { getTrackState } from '../../../repositories/track/getTrackState';
import { updateTrack } from '../../../repositories/track/updateTrack';

export function persistDevicePatch(deviceId: string, patch: Record<string, unknown>): void {
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
        devices: t.devices.map((d) => {
            if (d.id !== deviceId) {
                return d;
            }

            const parameterValues = { ...d.parameterValues };
            for (const [key, value] of Object.entries(patch)) {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    parameterValues[key] = value;
                }
            }

            return { ...d, parameterValues };
        }),
    }));
}
