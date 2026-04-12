import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeTrack } from '../../useCases/removeTrack';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveAllTracks = createHandler<'removeAllTracks'>({
    execute: () => {
        const state = getTrackStoreState();
        if (state) {
            for (const t of state.tracks) {
                removeTrack(t.id);
            }
        }
    },
    describe: () => ({ label: 'Remove all tracks' }),
    undoable: true,
});
