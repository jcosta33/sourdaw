import { createHandler } from '#/helpers/createHandler';
import { freezeTrack } from '#/modules/Arrangement/useCases/freezeBounce/freezeTrack';

export const handleFreezeTrack = createHandler<'freezeTrack'>({
    execute: async (action) => {
        await freezeTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Freeze track' }),
    undoable: true,
});
