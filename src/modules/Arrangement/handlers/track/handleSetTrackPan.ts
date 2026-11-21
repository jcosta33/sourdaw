import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { clampTrackPan } from '../../useCases/setTrackGainPan/clampTrackPan';
import { setTrackPan } from '../../useCases/setTrackGainPan/setTrackPan';
import { sessionEntryAgreesOnAutomationRecordingPolicy } from '../automationRecordingPolicy';
import { getPlannedTrackState } from '../getPlannedTrackState';

import { readPlannedDisplayTrack } from './readPlannedDisplayTrack';

export const handleSetTrackPan = createHandler<'setTrackPan'>({
    canReapplyAfterDivergence: () => true,
    validate: (action, context) => {
        const currentPan = getPlannedTrackState(context, action.payload.trackId)?.pan;
        // A NaN pan would be stored, and its inverse's `expectedPan` could never match it.
        // Batches refuse here; a single dispatch skips `validate`, so `execute` refuses too.
        return Number.isFinite(action.payload.pan) && currentPan === action.payload.expectedPan;
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
        if (currentPan !== action.payload.expectedPan || !Number.isFinite(action.payload.pan)) {
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
        return currentPan === action.payload.expectedPan && currentPan === clampTrackPan(action.payload.pan);
    },
    describe: (alpha, context) => {
        const prev = readPlannedDisplayTrack(alpha.payload.trackId, context);
        // Both replay legs inherit the forward policy: undoing or redoing a
        // static edit is still not a pan gesture.
        const automationRecordingPolicy = alpha.payload.automationRecordingPolicy;
        const carriedPolicy = automationRecordingPolicy === undefined ? {} : { automationRecordingPolicy };
        // The writer clamps, and the inverse's `expectedPan` is compared with the
        // stored value on the way back, so predict the written pan, not the request.
        const written = clampTrackPan(alpha.payload.pan);
        return {
            label: 'Set track pan',
            inverseAction: prev
                ? {
                      type: 'setTrackPan',
                      payload: {
                          trackId: alpha.payload.trackId,
                          pan: prev.pan,
                          expectedPan: written,
                          ...carriedPolicy,
                      },
                  }
                : null,
            redoAction: prev
                ? {
                      type: 'setTrackPan',
                      payload: {
                          trackId: alpha.payload.trackId,
                          pan: written,
                          expectedPan: prev.pan,
                          ...carriedPolicy,
                      },
                  }
                : undefined,
        };
    },
    undoable: true,
});
