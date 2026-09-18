import { createHandler } from '#/utils/createHandler';

import { compRegionInterval } from '../../useCases/comping/compRegionInterval';

export const handleRestoreCompRegionInterval = createHandler<'restoreCompRegionInterval'>({
    canReapplyAfterDivergence: (action) => compRegionInterval.isCompleteRestorePayload(action.payload),
    canReportConflict: true,
    validateMaterializedCommandArguments: compRegionInterval.isCompleteRestorePayload,
    validateSessionActionArguments: compRegionInterval.isCompleteRestorePayload,
    validate: (action, context) =>
        compRegionInterval.isCompleteRestorePayload(action.payload) &&
        compRegionInterval.patchApplies(action.payload, context),
    isNoop: (action) =>
        compRegionInterval.isCompleteRestorePayload(action.payload) && compRegionInterval.patchIsNoop(action.payload),
    execute: (action) => {
        if (!compRegionInterval.isCompleteRestorePayload(action.payload)) {
            return { status: 'conflict' };
        }
        return { status: compRegionInterval.applyPatch(action.payload) };
    },
    describe: () => ({ label: 'Restore comp region interval', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
