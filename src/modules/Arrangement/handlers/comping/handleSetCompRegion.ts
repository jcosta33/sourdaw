import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { compRegionInterval } from '../../useCases/comping/compRegionInterval';

type SetCompRegionAction = Extract<AppAction, { type: 'setCompRegion' }>;

function getPatch(action: SetCompRegionAction) {
    if (!compRegionInterval.isCompleteSetPayload(action.payload)) {
        return null;
    }
    const {
        laneId,
        trackId,
        startBeat,
        endBeat,
        expected,
        replacement,
        audioSourcePromotions,
        baseGapAudioSourceFieldPresence,
    } = action.payload;
    return {
        laneId,
        trackId,
        startBeat,
        endBeat,
        expected,
        replacement,
        ...(audioSourcePromotions === undefined ? {} : { audioSourcePromotions }),
        ...(baseGapAudioSourceFieldPresence === undefined ? {} : { baseGapAudioSourceFieldPresence }),
    };
}

export const handleSetCompRegion = createHandler<'setCompRegion'>({
    validateSessionEntry: compRegionInterval.isSessionEntry,
    canReportConflict: true,
    materializeCommandArguments: (action, context) => {
        delete action.payload.laneId;
        delete action.payload.expected;
        delete action.payload.replacement;
        delete action.payload.audioSourcePromotions;
        delete action.payload.baseGapAudioSourceFieldPresence;
        const patch = compRegionInterval.capturePatchAfterPrefix(action.payload, context);
        if (!patch) {
            return;
        }
        action.payload.laneId = patch.laneId;
        action.payload.expected = patch.expected;
        action.payload.replacement = patch.replacement;
        if (patch.audioSourcePromotions !== undefined)
            action.payload.audioSourcePromotions = patch.audioSourcePromotions;
        if (patch.baseGapAudioSourceFieldPresence !== undefined)
            action.payload.baseGapAudioSourceFieldPresence = patch.baseGapAudioSourceFieldPresence;
    },
    materializeCommandArgumentsAt: 'admission',
    validateMaterializedCommandArguments: compRegionInterval.isCompleteSetPayload,
    validate: (action, context) => {
        const patch = getPatch(action);
        return patch !== null && compRegionInterval.patchApplies(patch, context);
    },
    isNoop: (action) => {
        const patch = getPatch(action);
        return patch !== null && compRegionInterval.patchIsNoop(patch);
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
                payload: compRegionInterval.reversePatch(patch),
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
