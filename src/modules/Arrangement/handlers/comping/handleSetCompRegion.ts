import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { compRegionInterval } from '../../useCases/comping/compRegionInterval';

type SetCompRegionAction = Extract<AppAction, { type: 'setCompRegion' }>;

function getPatch(action: SetCompRegionAction) {
    if (!compRegionInterval.isCompleteSetPayload(action.payload)) {
        return null;
    }
    const { laneId, trackId, startBeat, endBeat, expected, replacement } = action.payload;
    return { laneId, trackId, startBeat, endBeat, expected, replacement };
}

export const handleSetCompRegion = createHandler<'setCompRegion'>({
    canReportConflict: true,
    materializeCommandArguments: (action) => {
        delete action.payload.laneId;
        delete action.payload.expected;
        delete action.payload.replacement;
        const patch = compRegionInterval.capturePatch(action.payload);
        if (!patch) {
            return;
        }
        action.payload.laneId = patch.laneId;
        action.payload.expected = patch.expected;
        action.payload.replacement = patch.replacement;
    },
    validateMaterializedCommandArguments: compRegionInterval.isCompleteSetPayload,
    validate: (action) => {
        const patch = getPatch(action);
        return patch !== null && compRegionInterval.patchApplies(patch);
    },
    execute: (action) => {
        const patch = getPatch(action);
        if (!patch) {
            return { status: 'conflict' };
        }
        return { status: compRegionInterval.applyPatch(patch) };
    },
    describe: (action) => {
        const patch = getPatch(action);
        if (!patch) {
            return { label: 'Set comp region', inverseAction: null };
        }
        return {
            label: 'Set comp region',
            inverseAction: {
                type: 'restoreCompRegionInterval',
                payload: { ...patch, expected: patch.replacement, replacement: patch.expected },
            },
            redoAction: {
                type: 'restoreCompRegionInterval',
                payload: patch,
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
