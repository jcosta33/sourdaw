import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';

import { applyDeviceChainRuntimeDelta } from './applyDeviceChainRuntimeDelta';

export function reorderDevices(trackId: string, fromIndex: number, toIndex: number): void {
    const track = getTrackById(trackId);
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceUpdate) {
        return;
    }
    if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        fromIndex >= track.devices.length ||
        toIndex < 0 ||
        toIndex >= track.devices.length ||
        fromIndex === toIndex
    ) {
        return;
    }
    const before = structuredClone(track);
    const devices = [...track.devices];
    const [moved] = devices.splice(fromIndex, 1);
    if (!moved) {
        return;
    }
    devices.splice(toIndex, 0, moved);
    const after = { ...track, devices };
    updateTrack(trackId, () => after);
    if (!shouldCreateLiveTrackStrip(track)) {
        return;
    }
    applyDeviceChainRuntimeDelta({ before, after, operation: 'reorder-device' });
}
