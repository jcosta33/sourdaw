import { getTrackState } from '../../../repositories/track/getTrackState';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { resolveEligibleDeviceWriteTarget } from '../../../stores/resolveEligibleDeviceWriteTarget';

export function persistDevicePatch(deviceId: string, patch: Record<string, unknown>): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const state = getTrackState();
    if (!state) {
        return;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    if (!track) {
        return;
    }

    updateTrack(track.id, (currentTrack) => ({
        ...currentTrack,
        devices: currentTrack.devices.map((device) => {
            if (device.id !== target.deviceId) {
                return device;
            }

            const parameterValues = { ...device.parameterValues };
            for (const [key, value] of Object.entries(patch)) {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    parameterValues[key] = value;
                }
            }

            return { ...device, parameterValues };
        }),
    }));
}
