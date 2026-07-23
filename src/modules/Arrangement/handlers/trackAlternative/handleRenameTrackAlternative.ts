import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';

export const handleRenameTrackAlternative = createHandler<'renameTrackAlternative'>({
    execute: (action) => {
        const state = getTrackStoreState();
        if (!state) {
            return;
        }

        const { trackId, alternativeId, name } = action.payload;

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== trackId) {
                    return track;
                }

                return {
                    ...track,
                    alternatives: track.alternatives.map((alt) => (alt.id === alternativeId ? { ...alt, name } : alt)),
                };
            }),
        });
    },
    describe: (action) => {
        const prev = getTrackStoreState()
            ?.tracks.find((track) => track.id === action.payload.trackId)
            ?.alternatives.find((alt) => alt.id === action.payload.alternativeId);
        return {
            label: 'Rename Alternative',
            inverseAction: prev
                ? {
                      type: 'renameTrackAlternative',
                      payload: { trackId: action.payload.trackId, alternativeId: prev.id, name: prev.name },
                  }
                : null,
        };
    },
    undoable: true,
});
