import { updateTrack } from '../../../repositories/track/updateTrack';

export function removeSend(trackId: string, busId: string): void {
    updateTrack(trackId, (time) => ({
        ...time,
        sends: time.sends.filter((state) => state.busId !== busId),
    }));
}
