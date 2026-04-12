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
                    alternatives: track.alternatives.map((alt) =>
                        alt.id === alternativeId ? { ...alt, name } : alt
                    ),
                };
            }),
        });
    },
    describe: () => ({ label: 'Rename Alternative' }),
    undoable: true,
});
