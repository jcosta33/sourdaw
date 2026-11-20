import { updateTrack } from '../../repositories/track/updateTrack';
import { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '../clampTrackHeight';

export function setTrackHeight(trackId: string, height: number): void {
    updateTrack(trackId, (time) => ({
        ...time,
        height: Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, height)),
    }));
}
