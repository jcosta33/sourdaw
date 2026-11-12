import { type DevicePatchState } from '../../models/DevicePatchState';
import { projectCapturedDevicePatch } from '../../models/projectCapturedDevicePatch';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { resolveEligibleDeviceWriteTarget } from '../../stores/resolveEligibleDeviceWriteTarget';

type ApplyDevicePatchStateInput = {
    deviceId: string;
    expected: DevicePatchState;
    next: DevicePatchState;
};

/** Apply only the captured chunk and numeric-leaf footprint in the caller's transaction. */
export function applyDevicePatchState({ deviceId, expected, next }: ApplyDevicePatchStateInput): boolean {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    const state = getTrackState();
    if (target.status !== 'eligible' || !state) {
        return false;
    }
    const owner = state.tracks.find((track) => track.id === target.trackId);
    const device = owner?.devices.find((candidate) => candidate.id === deviceId);
    if (!owner || !device || owner.frozen === true) {
        return false;
    }
    const nextDevice = projectCapturedDevicePatch(device, expected, next);
    if (!nextDevice) {
        return false;
    }
    // All guards and scalar laws finish before the single projection publication.
    updateTrack(owner.id, (track) => ({
        ...track,
        devices: track.devices.map((candidate) => {
            if (candidate.id !== deviceId) {
                return candidate;
            }
            return nextDevice;
        }),
    }));
    return true;
}
