import { createHandler } from '#/utils/createHandler';

import { transportStore } from '../../stores/transportStore';
import { replaceMasterGain } from '../../useCases/replaceMasterGain';

import { toMasterGainExecutionResult } from './toMasterGainExecutionResult';

export const handleSetMasterGain = createHandler<'setMasterGain'>({
    execute: (action) => {
        const currentGain = transportStore.value?.masterGain;
        if (currentGain === undefined) {
            return { status: 'no-write' };
        }
        return toMasterGainExecutionResult(
            replaceMasterGain({ expectedPercent: currentGain, replacementPercent: action.payload.gain * 100 })
        );
    },
    describe: (action) => {
        const currentGain = transportStore.value?.masterGain;
        return {
            label: 'Set master gain',
            inverseAction:
                currentGain === undefined
                    ? null
                    : {
                          type: 'restoreMasterGain',
                          payload: {
                              expectedPercent: action.payload.gain * 100,
                              replacementPercent: currentGain,
                          },
                      },
            redoAction:
                currentGain === undefined
                    ? action
                    : {
                          type: 'restoreMasterGain',
                          payload: {
                              expectedPercent: currentGain,
                              replacementPercent: action.payload.gain * 100,
                          },
                      },
        };
    },
    isNoop: (action) => {
        const currentGain = transportStore.value?.masterGain;
        return currentGain !== undefined && currentGain / 100 === action.payload.gain;
    },
    undoable: true,
});
