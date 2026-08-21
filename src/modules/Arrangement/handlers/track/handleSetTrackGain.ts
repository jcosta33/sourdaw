import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { clampTrackGain } from '../../useCases/setTrackGainPan/clampTrackGain';
import { setTrackGain } from '../../useCases/setTrackGainPan/setTrackGain';
import { getPlannedTrackState } from '../getPlannedTrackState';

/**
 * What this action will actually store, which is not always what it asked for:
 * `setTrackGain` holds a Toaster-pad-mirrored track at unity while every other
 * fader reaches `FADER_MAX_GAIN`.
 *
 * Every prediction this handler makes goes through here rather than through
 * `payload.gain`. The inverse entry's `expectedGain` is the reason: `execute`
 * compares it against the stored value on the way back, so an inverse built
 * from a request the writer clamped can never validate — undo returns
 * `conflict`, the pre-move value is unrecoverable, and the dead entry still
 * occupies one of the shared history's 200 slots. Before the fader widened both
 * ceilings were unity and this was unreachable; it is reachable now, on any
 * action-sourced write, because the mixer strip is no longer the only caller
 * that can ask above `1`.
 */
function writtenGain(action: { payload: { trackId: string; gain: number } }): number {
    return clampTrackGain(action.payload.trackId, action.payload.gain);
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
        return {
            label: 'Set track gain',
            inverseAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: previousGain,
                    expectedGain: written,
                },
            },
            redoAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: written,
                    expectedGain: previousGain,
                },
            },
        };
    },
    undoable: true,
});
