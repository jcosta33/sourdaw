import { createHandler } from '#/utils/createHandler';

import { clipSplitStateMatches } from '../../useCases/clipEditing/clipSplitStateMatches';
import { restoreClipSplitState } from '../../useCases/clipEditing/restoreClipSplitState';

import { isRestoreClipSplitSessionPayload } from './validateClipEditSessionEntries';

export const handleRestoreClipSplitState = createHandler<'restoreClipSplitState'>({
    validateSessionActionArguments: isRestoreClipSplitSessionPayload,
    canReapplyAfterDivergence: () => true,
    validate: clipSplitStateMatches,
    execute: (action) => (restoreClipSplitState(action.payload) ? { status: 'written' } : { status: 'conflict' }),
    describe: () => ({ label: 'Restore clip split state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
