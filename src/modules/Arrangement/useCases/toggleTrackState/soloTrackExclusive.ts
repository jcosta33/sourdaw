import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { applySoloLogic } from '../../services/applySoloLogic';

export function soloTrackExclusive(trackId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const soloedTracks = state.tracks.filter((t) => t.soloed);
    const isOnlySoloed = soloedTracks.length === 1 && soloedTracks[0]!.id === trackId;

    if (isOnlySoloed) {
        mapAllTracks((t) => ({ ...t, soloed: false }));
    } else {
        mapAllTracks((t) => ({ ...t, soloed: t.id === trackId }));
    }

    applySoloLogic();
}
