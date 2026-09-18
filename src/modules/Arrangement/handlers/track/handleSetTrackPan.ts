import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackPan } from '../../useCases/setTrackGainPan/setTrackPan';
import { sessionEntryAgreesOnAutomationRecordingPolicy } from '../automationRecordingPolicy';
import { getPlannedTrackState } from '../getPlannedTrackState';

export const handleSetTrackPan = createHandler<'setTrackPan'>({
    canReapplyAfterDivergence: () => true,
    validate: (action, context) => {
        const currentPan = getPlannedTrackState(context, action.payload.trackId)?.pan;
        return currentPan === action.payload.expectedPan;
    },
    // A suppressed edit cannot reach the recording maps, so snapshotting and
    // restoring them on abort would only be able to discard a pass some other
    // writer legitimately owns.
    prepareAbort: (action) =>
        action.payload.automationRecordingPolicy === 'suppressed'
            ? () => undefined
            : captureAutomationRecordingRollback(),
    execute: (action) => {
        const currentPan = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.pan;
        if (currentPan !== action.payload.expectedPan) {
            return { status: 'conflict' };
        }
        setTrackPan(action.payload.trackId, action.payload.pan, false, {
            automationRecordingPolicy: action.payload.automationRecordingPolicy,
        });
        return { status: 'written' };
    },
    validateSessionEntry: sessionEntryAgreesOnAutomationRecordingPolicy,
    isNoop: (action) => {
        const currentPan = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.pan;
        return currentPan === action.payload.expectedPan && currentPan === action.payload.pan;
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        // Both replay legs inherit the forward policy: undoing or redoing a
        // static edit is still not a pan gesture.
        const automationRecordingPolicy = alpha.payload.automationRecordingPolicy;
        const carriedPolicy = automationRecordingPolicy === undefined ? {} : { automationRecordingPolicy };
        return {
            label: 'Set track pan',
            inverseAction: prev
                ? {
                      type: 'setTrackPan',
                      payload: {
                          trackId: alpha.payload.trackId,
                          pan: prev.pan,
                          expectedPan: alpha.payload.pan,
                          ...carriedPolicy,
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
                          ...carriedPolicy,
                      },
                  }
                : undefined,
        };
    },
    undoable: true,
});
