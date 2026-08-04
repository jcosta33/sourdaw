import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import { applySoloLogic } from './applySoloLogic';

type ClearSolosInput = { deferRuntimeEffect?: boolean };

export function clearSolos({ deferRuntimeEffect = false }: ClearSolosInput = {}): boolean {
    const state = getTrackState();
    if (!state || !state.tracks.some((track) => track.soloed)) {
        return false;
    }
    mapAllTracks((time) => ({ ...time, soloed: false }));
    if (!deferRuntimeEffect) {
        applySoloLogic();
    }
    return true;
}
