import { createHandler } from '#/utils/createHandler';
import { reorderTrack } from '#/modules/Arrangement/useCases/toggleTrackState/reorderTrack';

export const handleReorderTrack = createHandler<'reorderTrack'>({
    execute: (action) => {
        reorderTrack(action.payload.trackId, action.payload.newIndex);
    },
    describe: () => ({ label: 'Reorder track' }),
    undoable: true,
});
