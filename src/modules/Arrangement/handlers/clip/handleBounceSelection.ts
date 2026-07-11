import { createHandler } from '#/utils/createHandler';

import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';

export const handleBounceSelection = createHandler<'bounceSelection'>({
    execute: (alpha) => {
        void bounceSelection(alpha.payload.trackId, alpha.payload.startBeat, alpha.payload.endBeat);
    },
    describe: () => ({ label: 'Bounce selection to audio' }),
    undoable: true,
});
