import { createHandler } from '#/utils/createHandler';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';

export const handleSwitchTrackAlternative = createHandler<'switchTrackAlternative'>({
    execute: (action) => {
        const state = getTrackStoreState();
        if (!state) {
            return;
        }

        const { trackId, alternativeId } = action.payload;

        const targetTrack = state.tracks.find((t) => t.id === trackId);
        if (!targetTrack || targetTrack.activeAlternativeId === alternativeId) {
            return;
        }

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== trackId) {
                    return track;
                }

                const targetAlt = track.alternatives.find((a) => a.id === alternativeId);
                if (!targetAlt) {
                    return track;
                }

                // Save the currently active clips into the outgoing alternative array slot
                const updatedAlternatives = track.alternatives.map((alt) => {
                    if (alt.id === track.activeAlternativeId) {
                        return { ...alt, clips: [...track.clips] };
                    }
                    return alt;
                });

                return {
                    ...track,
                    alternatives: updatedAlternatives,
                    activeAlternativeId: alternativeId,
                    clips: [...targetAlt.clips],
                };
            }),
        });
    },
    describe: () => ({ label: 'Switch Alternative' }),
    undoable: true,
});
