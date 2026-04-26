import { createHandler } from '#/utils/createHandler';

import { foldTrack } from '../../useCases/toggleTrackState/foldTrack';

export const handleFoldTrack = createHandler<'foldTrack'>({
    execute: (action) => {
        foldTrack(action.payload.trackId, action.payload.folded);
    },
    describe: (alpha) => ({ label: alpha.payload.folded ? 'Fold track' : 'Unfold track' }),
    undoable: true,
});
