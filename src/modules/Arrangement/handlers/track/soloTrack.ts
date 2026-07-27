import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { soloTrack } from '../../useCases/toggleTrackState/soloTrack';

export const handleSoloTrack = createHandler<'soloTrack'>({
    execute: (action) => {
        soloTrack(action.payload.trackId, action.payload.soloed);
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.soloed ===
        action.payload.soloed,
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: action.payload.soloed ? 'Solo track' : 'Unsolo track',
            inverseAction: track
                ? {
                      type: 'soloTrack',
                      payload: { trackId: track.id, soloed: track.soloed },
                  }
                : null,
        };
    },
    undoable: true,
});
