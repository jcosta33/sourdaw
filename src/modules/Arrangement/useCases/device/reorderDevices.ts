import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

export function reorderDevices(trackId: string, fromIndex: number, toIndex: number): void {
    const track = getTrackById(trackId);
    if (track && !getTrackEligibility(track.kind).acceptsDeviceUpdate) {
        return;
    }
    updateTrack(trackId, (time) => {
        const devices = [...time.devices];
        const [moved] = devices.splice(fromIndex, 1);
        if (moved) {
            devices.splice(toIndex, 0, moved);
        }
        return { ...time, devices };
    });
}
