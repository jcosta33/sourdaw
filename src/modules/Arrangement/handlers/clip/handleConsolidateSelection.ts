import { createHandler } from '#/utils/createHandler';
import { bounceSelection } from '../../useCases/freezeBounce/bounceOperations';

export const handleConsolidateSelection = createHandler<'consolidateSelection'>({
    execute: async (a) => {
        await bounceSelection(a.payload.trackId, a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Consolidate selection' }),
    undoable: true,
});
