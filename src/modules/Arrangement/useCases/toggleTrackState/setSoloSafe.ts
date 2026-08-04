import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';

import { applySoloLogic } from './applySoloLogic';

type SetSoloSafeInput = {
    trackId: string;
    soloSafe: boolean;
    deferRuntimeEffect?: boolean;
};

export function setSoloSafe({ trackId, soloSafe, deferRuntimeEffect = false }: SetSoloSafeInput): boolean {
    const track = getTrackState()?.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.soloSafe === soloSafe) {
        return false;
    }
    updateTrack(trackId, (candidate) => ({ ...candidate, soloSafe }));
    if (!deferRuntimeEffect) {
        applySoloLogic();
    }
    return true;
}
