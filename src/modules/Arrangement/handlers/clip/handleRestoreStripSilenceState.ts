import { createHandler } from '#/utils/createHandler';

import { restoreStripSilenceState } from '../../useCases/restoreStripSilenceState';

export const handleRestoreStripSilenceState = createHandler<'restoreStripSilenceState'>({
    execute: (action) => {
        return restoreStripSilenceState(action.payload) ? { status: 'written' } : { status: 'conflict' };
    },
    describe: () => ({ label: 'Restore strip silence state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
