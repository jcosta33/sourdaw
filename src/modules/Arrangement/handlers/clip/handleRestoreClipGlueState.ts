import { createHandler } from '#/utils/createHandler';

import { clipGlueStateRestorable } from '../../useCases/clipEditing/clipGlueStateRestorable';
import { restoreClipGlueState } from '../../useCases/clipEditing/restoreClipGlueState';

export const handleRestoreClipGlueState = createHandler<'restoreClipGlueState'>({
    // `expected`/`replacement` are mandatory on this payload, so every instance carries a real
    // precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: (action) => clipGlueStateRestorable(action.payload),
    execute: (action) => {
        return restoreClipGlueState(action.payload) ? { status: 'written' } : { status: 'conflict' };
    },
    describe: () => ({ label: 'Restore clip glue state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
