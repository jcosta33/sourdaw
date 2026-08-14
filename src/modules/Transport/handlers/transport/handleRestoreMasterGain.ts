import { createHandler } from '#/utils/createHandler';

import { transportStore } from '../../stores/transportStore';
import { replaceMasterGain } from '../../useCases/replaceMasterGain';

import { toMasterGainExecutionResult } from './toMasterGainExecutionResult';

export const handleRestoreMasterGain = createHandler<'restoreMasterGain'>({
    canReapplyAfterDivergence: () => true,
    validate: (action) => transportStore.value?.masterGain === action.payload.expectedPercent,
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
