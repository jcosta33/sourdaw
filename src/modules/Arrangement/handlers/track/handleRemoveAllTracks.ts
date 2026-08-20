import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeTrack } from '../../useCases/removeTrack';

export const handleRemoveAllTracks = createHandler<'removeAllTracks'>({
    execute: () => {
        const state = getTrackStoreState();
        if (state) {
            for (const time of state.tracks) {
                removeTrack(time.id);
            }
        }
    },
    describe: () => ({ label: 'Remove all tracks' }),
    undoable: false,
});
