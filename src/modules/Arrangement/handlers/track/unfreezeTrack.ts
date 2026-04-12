import { createHandler } from '#/utils/createHandler';
import { unfreezeTrack } from '#/modules/Arrangement/useCases/freezeBounce/freezeTrack/unfreezeTrack';

export const handleUnfreezeTrack = createHandler<'unfreezeTrack'>({
    execute: (action) => {
        unfreezeTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Unfreeze track' }),
    undoable: true,
});
