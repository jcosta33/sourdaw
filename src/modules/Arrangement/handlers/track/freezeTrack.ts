import { createHandler } from '#/utils/createHandler';
import { freezeTrack } from '../../useCases/freezeBounce/freezeTrack';

export const handleFreezeTrack = createHandler<'freezeTrack'>({
    execute: async (action) => {
        await freezeTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Freeze track' }),
    undoable: true,
});
