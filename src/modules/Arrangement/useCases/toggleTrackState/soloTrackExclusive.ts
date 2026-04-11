import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { mapAllTracks } from '#/modules/Arrangement/repositories/track/mapAllTracks';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';

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
