import { updateTrack } from '../../repositories/track/updateTrack';

export function reorderDevices(trackId: string, fromIndex: number, toIndex: number): void {
    updateTrack(trackId, (t) => {
        const devices = [...t.devices];
        const [moved] = devices.splice(fromIndex, 1);
        if (moved) {
            devices.splice(toIndex, 0, moved);
        }
        return { ...t, devices };
    });
}
