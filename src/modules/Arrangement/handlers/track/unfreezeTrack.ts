import { createHandler } from '#/utils/createHandler';
import { unfreezeTrack } from '../../useCases/freezeBounce/freezeTrack/unfreezeTrack';

export const handleUnfreezeTrack = createHandler<'unfreezeTrack'>({
    execute: (action) => {
        unfreezeTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Unfreeze track' }),
    undoable: true,
});
