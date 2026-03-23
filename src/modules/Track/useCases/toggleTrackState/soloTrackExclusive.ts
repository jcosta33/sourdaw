import { getTrackState, mapAllTracks } from '#/modules/Track/repositories/trackRepository';
import { applySoloLogic } from '#/modules/Track/helpers/applySoloLogic';

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
