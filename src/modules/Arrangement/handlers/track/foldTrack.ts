import { createHandler } from '#/utils/createHandler';
import { foldTrack } from '../../useCases/toggleTrackState/foldTrack';

export const handleFoldTrack = createHandler<'foldTrack'>({
    execute: (action) => {
        foldTrack(action.payload.trackId, action.payload.folded);
    },
    describe: (a) => ({ label: a.payload.folded ? 'Fold track' : 'Unfold track' }),
    undoable: true,
});
