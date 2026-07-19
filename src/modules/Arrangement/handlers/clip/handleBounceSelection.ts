import { runLegacyCommandMutationUnderOwner } from '#/modules/Command/useCases';
import { createHandler } from '#/utils/createHandler';

import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';

export const handleBounceSelection = createHandler<'bounceSelection'>({
    execute: (alpha) =>
        bounceSelection(
            alpha.payload.trackId,
            alpha.payload.startBeat,
            alpha.payload.endBeat,
            runLegacyCommandMutationUnderOwner
        ),
    describe: () => ({ label: 'Bounce selection to audio' }),
    undoable: true,
});
