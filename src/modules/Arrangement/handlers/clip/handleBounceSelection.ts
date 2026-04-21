import { createHandler } from '#/utils/createHandler';

import { bounceSelection } from '../../useCases/freezeBounce/bounceOperations';

export const handleBounceSelection = createHandler<'bounceSelection'>({
    execute: (a) => {
        void bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Bounce selection to audio' }),
    undoable: true,
});
