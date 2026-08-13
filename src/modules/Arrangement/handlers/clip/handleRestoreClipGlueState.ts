import { createHandler } from '#/utils/createHandler';

import { restoreClipGlueState } from '../../useCases/clipEditing/restoreClipGlueState';

export const handleRestoreClipGlueState = createHandler<'restoreClipGlueState'>({
    execute: (action) => {
        return restoreClipGlueState(action.payload) ? { status: 'written' } : { status: 'conflict' };
    },
    describe: () => ({ label: 'Restore clip glue state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
