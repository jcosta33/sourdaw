import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import { applySoloLogic } from './applySoloLogic';

export function soloTrackExclusive(trackId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const soloedTracks = state.tracks.filter((time) => time.soloed);
    const isOnlySoloed = soloedTracks.length === 1 && soloedTracks[0]!.id === trackId;

    if (isOnlySoloed) {
        mapAllTracks((time) => ({ ...time, soloed: false }));
    } else {
        mapAllTracks((time) => ({ ...time, soloed: time.id === trackId }));
    }

    applySoloLogic();
}
