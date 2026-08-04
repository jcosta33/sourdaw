import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import { applySoloLogic } from './applySoloLogic';

type TrackSoloState = { trackId: string; soloed: boolean };

type RestoreTrackSoloStatesInput = {
    states: readonly TrackSoloState[];
    deferRuntimeEffect?: boolean;
};

export function restoreTrackSoloStates({ states, deferRuntimeEffect = false }: RestoreTrackSoloStatesInput): boolean {
    const trackState = getTrackState();
    if (!trackState || states.length === 0) {
        return false;
    }

    const replacements = new Map(states.map((state) => [state.trackId, state.soloed]));
    if (
        replacements.size !== states.length ||
        states.some((state) => !trackState.tracks.some((track) => track.id === state.trackId))
    ) {
        return false;
    }

    mapAllTracks((track) => {
        const soloed = replacements.get(track.id);
        return soloed === undefined ? track : { ...track, soloed };
    });
    if (!deferRuntimeEffect) {
        applySoloLogic();
    }
    return true;
}
