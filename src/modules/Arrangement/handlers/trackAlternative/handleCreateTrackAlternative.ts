import { createHandler } from '#/helpers/createHandler';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';

type TrackState = NonNullable<ReturnType<typeof getTrackStoreState>>;
type Track = TrackState['tracks'][number];
type Clip = Track['clips'][number];
type TrackAlternative = Track['alternatives'][number];

export const handleCreateTrackAlternative = createHandler<'createTrackAlternative'>({
    execute: (action) => {
        const state = getTrackStoreState();
        if (!state) {
            return;
        }

        const { trackId, name, duplicateActive } = action.payload;

        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== trackId) {
                    return track;
                }

                const newAltId = `alt-${crypto.randomUUID()}`;

                // Deep clone active clips if duplicating, else empty
                const newClips: Clip[] = duplicateActive
                    ? track.clips.map((c) => ({ ...c, id: `clip-${crypto.randomUUID()}` }))
                    : [];

                const newAlternative: TrackAlternative = {
                    id: newAltId,
                    name,
                    clips: newClips,
                };

                // Save current active clips to current active alternative
                const updatedAlternatives = track.alternatives.map((alt) =>
                    alt.id === track.activeAlternativeId ? { ...alt, clips: [...track.clips] } : alt
                );

                updatedAlternatives.push(newAlternative);

                return {
                    ...track,
                    alternatives: updatedAlternatives,
                    activeAlternativeId: newAltId,
                    clips: newClips,
                };
            }),
        });
    },
    describe: () => ({ label: 'Create Alternative' }),
    undoable: true,
});
