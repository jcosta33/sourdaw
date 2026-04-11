import { updateTrack } from '../../../repositories/track/updateTrack';

export function removeSend(trackId: string, busId: string): void {
    updateTrack(trackId, (t) => ({
        ...t,
        sends: t.sends.filter((s) => s.busId !== busId),
    }));
}