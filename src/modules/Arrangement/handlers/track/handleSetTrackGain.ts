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
        return {
            label: 'Set track gain',
            inverseAction: prev
                ? {
                      type: 'setTrackGain',
                      payload: {
                          trackId: alpha.payload.trackId,
                          gain: prev.gain,
                          expectedGain: alpha.payload.gain,
                      },
                  }
                : null,
            redoAction: prev
                ? {
                      type: 'setTrackGain',
                      payload: {
                          trackId: alpha.payload.trackId,
                          gain: alpha.payload.gain,
                          expectedGain: prev.gain,
                      },
                  }
                : undefined,
        };
    },
    undoable: true,
});
