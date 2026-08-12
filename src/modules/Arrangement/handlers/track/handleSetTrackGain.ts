import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackGain } from '../../useCases/setTrackGainPan/setTrackGain';

export const handleSetTrackGain = createHandler<'setTrackGain'>({
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
        return currentGain === action.payload.expectedGain && currentGain === action.payload.gain;
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        const previousGain = prev?.gain ?? alpha.payload.expectedGain;
        return {
            label: 'Set track gain',
            inverseAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: previousGain,
                    expectedGain: alpha.payload.gain,
                },
            },
            redoAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: alpha.payload.gain,
                    expectedGain: previousGain,
                },
            },
        };
    },
    undoable: true,
});
