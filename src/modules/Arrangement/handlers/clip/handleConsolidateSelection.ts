import { createHandler } from '#/utils/createHandler';

import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';

export const handleConsolidateSelection = createHandler<'consolidateSelection'>({
    execute: async (alpha) => {
        await bounceSelection(alpha.payload.trackId, alpha.payload.startBeat, alpha.payload.endBeat);
    },
    describe: () => ({ label: 'Consolidate selection' }),
    undoable: true,
});
