import { mapAllTracks } from '../repositories/track/mapAllTracks';

export function zoomTracksVertical(delta: number): void {
    mapAllTracks((time) => ({
        ...time,
        height: Math.max(30, Math.min(300, (time.height ?? 64) + delta)),
    }));
}
