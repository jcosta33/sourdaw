import { type LevelResolution, resolveLevelFields, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { transportStore } from '../../stores/transportStore';
import { replaceMasterGain } from '../../useCases/replaceMasterGain';

import { toMasterGainExecutionResult } from './toMasterGainExecutionResult';

type SetMasterGainAction = Extract<AppAction, { type: 'setMasterGain' }>;

/**
 * The linear fraction this action asks for, whichever way it asked.
 *
 * The store keeps a 0–100 percent while the payload speaks the same linear
 * fraction a track fader does. The resolution stays in the fraction, and only
 * the write scales it up: comparing in the percent domain instead would make an
 * exact repeat of the stored level miss by a float (`0.8 * 100` is not `80`).
 */
function requestedGain(action: SetMasterGainAction, currentPercent: number): LevelResolution {
    return resolveLevelFields(
        { linear: action.payload.gain, absoluteDb: action.payload.gainDb, deltaDb: action.payload.deltaDb },
        currentPercent / 100,
        TRACK_FADER_LAW
    );
}

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
        const requested = requestedGain(action, currentGain);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        return toMasterGainExecutionResult(
            replaceMasterGain({ expectedPercent: currentGain, replacementPercent: requested.linear * 100 })
        );
    },
    describe: (action) => {
        const currentGain = transportStore.value?.masterGain;
        const requested = currentGain === undefined ? null : requestedGain(action, currentGain);
        if (currentGain === undefined || !requested?.ok) {
            return { label: 'Set master gain', inverseAction: null, redoAction: action };
        }
        return {
            label: 'Set master gain',
            // Both replay legs carry percents: a stored level is what an undo has
            // to put back, whatever form the forward action used to ask for it.
            inverseAction: {
                type: 'restoreMasterGain',
                payload: { expectedPercent: requested.linear * 100, replacementPercent: currentGain },
            },
            redoAction: {
                type: 'restoreMasterGain',
                payload: { expectedPercent: currentGain, replacementPercent: requested.linear * 100 },
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
        const requested = requestedGain(action, currentGain);
        return requested.ok && currentGain / 100 === requested.linear;
    },
    undoable: true,
});
