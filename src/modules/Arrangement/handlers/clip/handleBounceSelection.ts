import { createHandler } from '#/utils/createHandler';

import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';

export const handleBounceSelection = createHandler<'bounceSelection'>({
    execute: (alpha, context) => {
        if (!context?.runLegacyCommandMutation) {
            throw new Error('Command execution context is required to bounce a selection');
        }
        return bounceSelection(
            alpha.payload.trackId,
            alpha.payload.startBeat,
            alpha.payload.endBeat,
            context.runLegacyCommandMutation
        );
    },
    describe: () => ({ label: 'Bounce selection to audio' }),
    undoable: true,
});
