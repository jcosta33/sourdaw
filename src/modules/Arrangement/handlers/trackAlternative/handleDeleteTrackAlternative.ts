import { createHandler } from '#/utils/createHandler';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';

export const handleDeleteTrackAlternative = createHandler<'deleteTrackAlternative'>({
    execute: (action) => {
        const state = getTrackStoreState();
        if (!state) {
            return;
        }

        const { trackId, alternativeId } = action.payload;

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== trackId) {
                    return track;
                }
                if (track.alternatives.length <= 1) {
                    return track;
                }

                const filteredAlts = track.alternatives.filter((alt) => alt.id !== alternativeId);

                if (track.activeAlternativeId === alternativeId) {
                    const fallbackAlt = filteredAlts[0]!;
                    return {
                        ...track,
                        alternatives: filteredAlts,
                        activeAlternativeId: fallbackAlt.id,
                        clips: [...fallbackAlt.clips],
                    };
                }

                return {
                    ...track,
                    alternatives: filteredAlts,
                };
            }),
        });
    },
    describe: () => ({ label: 'Delete Alternative' }),
    undoable: true,
});
