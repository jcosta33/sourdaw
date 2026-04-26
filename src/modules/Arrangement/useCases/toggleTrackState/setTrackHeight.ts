import { updateTrack } from '../../repositories/track/updateTrack';

export function setTrackHeight(trackId: string, height: number): void {
    updateTrack(trackId, (time) => ({ ...time, height: Math.max(30, Math.min(300, height)) }));
}
