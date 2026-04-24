import { updateTrack } from '../../repositories/track/updateTrack';

export function setTrackColor(trackId: string, color: string): void {
    updateTrack(trackId, (time) => ({ ...time, color }));
}
