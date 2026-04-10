import { createHandler } from '#/helpers/createHandler';
import { unfreezeTrack } from '#/modules/Arrangement/useCases/freezeBounce/freezeTrack';

export const handleUnfreezeTrack = createHandler<'unfreezeTrack'>({
    execute: (action) => {
        unfreezeTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Unfreeze track' }),
    undoable: true,
});
