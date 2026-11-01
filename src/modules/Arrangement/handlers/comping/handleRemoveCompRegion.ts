import { createHandler } from '#/utils/createHandler';

import { compRegionInterval } from '../../useCases/comping/compRegionInterval';

export const handleRemoveCompRegion = createHandler<'removeCompRegion'>({
    validateSessionEntry: compRegionInterval.isSessionEntry,
    canReportConflict: true,
    materializeCommandArguments: (action, context) => {
        const { trackId, startBeat } = action.payload;
        action.payload = { trackId, startBeat };
        const patch = compRegionInterval.captureRemovePatchAfterPrefix(action.payload, context);
        if (patch) {
            action.payload = patch;
        }
    },
    materializeCommandArgumentsAt: 'admission',
    validateMaterializedCommandArguments: compRegionInterval.isCompleteRemovePayload,
    validate: (action, context) =>
        compRegionInterval.isCompleteRemovePayload(action.payload) &&
        compRegionInterval.patchApplies(action.payload, context),
    isNoop: (action) =>
        compRegionInterval.isCompleteRemovePayload(action.payload) && compRegionInterval.patchIsNoop(action.payload),
    execute: (action) => {
        if (!compRegionInterval.isCompleteRemovePayload(action.payload)) {
            return { status: 'conflict' };
        }
        return { status: compRegionInterval.applyPatch(action.payload) };
    },
    describe: (action) => {
        if (!compRegionInterval.isCompleteRemovePayload(action.payload)) {
            return { label: 'Remove comp region', inverseAction: null };
        }
        return {
            label: 'Remove comp region',
            inverseAction: {
                type: 'restoreCompRegionInterval',
                payload: compRegionInterval.reversePatch(action.payload),
            },
            redoAction: { type: 'restoreCompRegionInterval', payload: action.payload },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
