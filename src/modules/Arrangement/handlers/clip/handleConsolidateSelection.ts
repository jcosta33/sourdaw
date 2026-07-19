import { createHandler } from '#/utils/createHandler';

import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';

export const handleConsolidateSelection = createHandler<'consolidateSelection'>({
    execute: async (alpha, context) => {
        if (!context?.runLegacyCommandMutation) {
            throw new Error('Command execution context is required to consolidate a selection');
        }
        await bounceSelection(
            alpha.payload.trackId,
            alpha.payload.startBeat,
            alpha.payload.endBeat,
            context.runLegacyCommandMutation
        );
    },
    describe: () => ({ label: 'Consolidate selection' }),
    undoable: true,
});
