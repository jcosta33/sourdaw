import { createHandler } from '#/utils/createHandler';

import { bounceInPlace } from '../../useCases/freezeBounce/bounceOperations';

export const handleBounceInPlace = createHandler<'bounceInPlace'>({
    execute: (action) => {
        bounceInPlace(action.payload.trackId);
    },
    describe: () => ({ label: 'Bounce in place' }),
    undoable: true,
});
