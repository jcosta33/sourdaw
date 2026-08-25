import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { clampTrackGain } from '../../useCases/setTrackGainPan/clampTrackGain';
import { setTrackGain } from '../../useCases/setTrackGainPan/setTrackGain';
import { getPlannedTrackState } from '../getPlannedTrackState';

/**
 * What this action will actually store, which is not always what it asked for:
 * the fader law clamps any request above `FADER_MAX_GAIN`.
 *
 * Every prediction this handler makes goes through here rather than through
 * `payload.gain`. The inverse entry's `expectedGain` is the reason: `execute`
 * compares it against the stored value on the way back, so an inverse built
 * from a request the writer clamped can never validate — undo returns
 * `conflict`, the pre-move value is unrecoverable, and the dead entry still
 * occupies one of the shared history's 200 slots. Any action-sourced write can
 * ask above the ceiling — the mixer strip is not the only caller — so the
 * prediction and the write share one clamp.
 */
function writtenGain(action: { payload: { trackId: string; gain: number } }): number {
    return clampTrackGain(action.payload.gain);
}

export const handleSetTrackGain = createHandler<'setTrackGain'>({
    canReapplyAfterDivergence: () => true,
    validate: (action, context) => {
        const currentGain = getPlannedTrackState(context, action.payload.trackId)?.gain;
        return currentGain === action.payload.expectedGain;
    },
    prepareAbort: () => captureAutomationRecordingRollback(),
    execute: (action) => {
        const currentGain = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.gain;
        if (currentGain !== action.payload.expectedGain) {
            return { status: 'conflict' };
        }
        setTrackGain(action.payload.trackId, action.payload.gain);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const currentGain = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.gain;
        return currentGain === action.payload.expectedGain && currentGain === writtenGain(action);
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        const previousGain = prev?.gain ?? alpha.payload.expectedGain;
        const written = writtenGain(alpha);
        // The inverse's own request goes through the writer for the same reason
        // the forward one does. `previousGain` is read raw off the store, and the
        // store can legitimately hold a value the writer would refuse by the time
        // undo runs — a request above `FADER_MAX_GAIN` stores clamped — so an
        // inverse promising the raw value restores something else and the paired
        // redo's `expectedGain` — which is this same number — then mismatches
        // and conflicts. Predicting from the writer on both legs closes that
        // rather than reasoning about how narrow the window is.
        const restored = clampTrackGain(previousGain);
        return {
            label: 'Set track gain',
            inverseAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: restored,
                    expectedGain: written,
                },
            },
            redoAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: written,
                    expectedGain: restored,
                },
            },
        };
    },
    undoable: true,
});
