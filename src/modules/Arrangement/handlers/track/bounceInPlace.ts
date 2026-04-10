import { createHandler } from '#/helpers/createHandler';
import { bounceInPlace } from '#/modules/Arrangement/useCases/freezeBounce/bounceOperations';

export const handleBounceInPlace = createHandler<'bounceInPlace'>({
    execute: (action) => {
        bounceInPlace(action.payload.trackId);
    },
    describe: () => ({ label: 'Bounce in place' }),
    undoable: true,
});
