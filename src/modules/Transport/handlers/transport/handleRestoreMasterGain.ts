import { createHandler } from '#/utils/createHandler';

import { transportStore } from '../../stores/transportStore';
import { replaceMasterGain } from '../../useCases/replaceMasterGain';

import { projectMasterGainThroughPriorBatchActions } from './projectMasterGainThroughPriorBatchActions';
import { toMasterGainExecutionResult } from './toMasterGainExecutionResult';

export const handleRestoreMasterGain = createHandler<'restoreMasterGain'>({
    canReapplyAfterDivergence: () => true,
    validate: (action, context) => {
        const liveGain = transportStore.value?.masterGain;
        if (liveGain === undefined) {
            return false;
        }
        // A grouped undo replays a compounding `setMasterGain` group as one
        // atomic batch of `restoreMasterGain` inverses, newest first: the second
        // one to validate expects the intermediate percent the first restore in
        // this same batch will leave behind, not the live pre-batch percent —
        // `validate` runs for every action before any `execute`.
        return projectMasterGainThroughPriorBatchActions(liveGain, context) === action.payload.expectedPercent;
    },
    execute: (action) => {
        if (transportStore.value?.masterGain !== action.payload.expectedPercent) {
            return { status: 'conflict' };
        }
        return toMasterGainExecutionResult(
            replaceMasterGain({
                expectedPercent: action.payload.expectedPercent,
                replacementPercent: action.payload.replacementPercent,
            })
        );
    },
    describe: () => ({ label: 'Restore master gain', inverseAction: null }),
    isNoop: (action) => transportStore.value?.masterGain === action.payload.replacementPercent,
    undoable: false,
});
