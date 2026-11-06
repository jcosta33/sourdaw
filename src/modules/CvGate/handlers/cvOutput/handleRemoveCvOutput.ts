import { createHandler } from '#/utils/createHandler';

import { removeCvOutput } from '../../useCases/cvOutputOperations/removeCvOutput';

// Undo-machinery inverse of `addCvOutput` (#4615) — no UI dispatcher dispatches
// it fresh, so like the dedicated discard handlers it is not itself undoable.
export const handleRemoveCvOutput = createHandler<'removeCvOutput'>({
    execute: (alpha) => {
        removeCvOutput(alpha.payload.outputId);
        return { status: 'written' };
    },
    describe: () => ({ label: 'Remove CV/Gate Output' }),
    undoable: false,
});
