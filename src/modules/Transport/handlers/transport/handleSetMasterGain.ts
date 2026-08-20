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
        // A caller that derived `gain` from a percent it read earlier carries that
        // percent back as `expectedPercent`. Admission is asynchronous, so the
        // fader may have moved since — conflict rather than overwrite the mover.
        if (action.payload.expectedPercent !== undefined && currentGain !== action.payload.expectedPercent) {
            return { status: 'conflict' };
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
        if (currentGain === undefined) {
            return false;
        }
        // A diverged guard must reach `execute` to be reported as a conflict;
        // treating it as a no-op would swallow the divergence silently.
        if (action.payload.expectedPercent !== undefined && currentGain !== action.payload.expectedPercent) {
            return false;
        }
        return currentGain / 100 === action.payload.gain;
    },
    undoable: true,
});
