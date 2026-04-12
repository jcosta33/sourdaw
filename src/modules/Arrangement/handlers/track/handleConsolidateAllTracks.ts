import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { createHandler } from '#/utils/createHandler';
import { bounceInPlace } from '../../useCases/freezeBounce/bounceOperations';

export const handleConsolidateAllTracks = createHandler<'consolidateAllTracks'>({
    execute: async () => {
        const state = getTrackStoreState();
        if (!state) {
            return;
        }
        for (const track of state.tracks) {
            if ((track.kind === 'audio' || track.kind === 'midi') && track.clips.length > 0) {
                await bounceInPlace(track.id);
            }
        }
    },
    describe: () => ({ label: 'Consolidate all tracks' }),
    undoable: true,
});
