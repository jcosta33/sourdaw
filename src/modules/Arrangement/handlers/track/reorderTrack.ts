import { createHandler } from '#/utils/createHandler';
import { reorderTrack } from '../../useCases/toggleTrackState/reorderTrack';

export const handleReorderTrack = createHandler<'reorderTrack'>({
    execute: (action) => {
        reorderTrack(action.payload.trackId, action.payload.newIndex);
    },
    describe: () => ({ label: 'Reorder track' }),
    undoable: true,
});
