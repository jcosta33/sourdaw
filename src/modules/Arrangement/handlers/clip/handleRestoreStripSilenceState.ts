import { createHandler } from '#/utils/createHandler';

import { restoreStripSilenceState } from '../../useCases/restoreStripSilenceState';

import { isClipReplacementRestorePayload } from './validateClipReplacementSessionEntries';

export const handleRestoreStripSilenceState = createHandler<'restoreStripSilenceState'>({
    validateSessionActionArguments: isClipReplacementRestorePayload,
    execute: (action) => {
        return restoreStripSilenceState(action.payload) ? { status: 'written' } : { status: 'conflict' };
    },
    describe: () => ({ label: 'Restore strip silence state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
