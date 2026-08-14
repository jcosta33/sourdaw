import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackPan } from '../../useCases/setTrackGainPan/setTrackPan';
import { getPlannedTrackState } from '../getPlannedTrackState';

export const handleSetTrackPan = createHandler<'setTrackPan'>({
    canReapplyAfterDivergence: () => true,
    validate: (action, context) => {
        const currentPan = getPlannedTrackState(context, action.payload.trackId)?.pan;
        return currentPan === action.payload.expectedPan;
    },
    prepareAbort: () => captureAutomationRecordingRollback(),
    execute: (action) => {
        const currentPan = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.pan;
        if (currentPan !== action.payload.expectedPan) {
            return { status: 'conflict' };
        }
        setTrackPan(action.payload.trackId, action.payload.pan);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const currentPan = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.pan;
        return currentPan === action.payload.expectedPan && currentPan === action.payload.pan;
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: 'Set track pan',
            inverseAction: prev
                ? {
                      type: 'setTrackPan',
                      payload: {
                          trackId: alpha.payload.trackId,
                          pan: prev.pan,
                          expectedPan: alpha.payload.pan,
                      },
                  }
                : null,
            redoAction: prev
                ? {
                      type: 'setTrackPan',
                      payload: {
                          trackId: alpha.payload.trackId,
                          pan: alpha.payload.pan,
                          expectedPan: prev.pan,
                      },
                  }
                : undefined,
        };
    },
    undoable: true,
});
