import { mapAllTracks } from '../repositories/track/mapAllTracks';

import { clampTrackHeight } from './clampTrackHeight';

export function zoomTracksVertical(delta: number): void {
    mapAllTracks((time) => ({
        ...time,
        height: clampTrackHeight(time.height, delta),
    }));
}
