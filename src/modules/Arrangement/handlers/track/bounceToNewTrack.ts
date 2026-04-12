import { createHandler } from '#/utils/createHandler';
import { bounceToNewTrack } from '#/modules/Arrangement/useCases/freezeBounce/bounceOperations';

export const handleBounceToNewTrack = createHandler<'bounceToNewTrack'>({
    execute: async (action) => {
        await bounceToNewTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Bounce to new track' }),
    undoable: true,
});
