import { captureAutomationRecordingRollback } from '#/modules/Automation/useCases';
import { type LevelResolution, resolveLevelFields, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { clampTrackGain } from '../../useCases/setTrackGainPan/clampTrackGain';
import { setTrackGain } from '../../useCases/setTrackGainPan/setTrackGain';
import { sessionEntryAgreesOnAutomationRecordingPolicy } from '../automationRecordingPolicy';
import { getPlannedTrackState } from '../getPlannedTrackState';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

function storedGain(trackId: string): number | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.gain;
}

/**
 * The linear amplitude this action asks for, whichever way it asked.
 *
 * The decibel forms are the only ones that need the live gain: an absolute
 * level is judged against the fader law, and a relative one is measured from
 * where the fader is now. The linear form is already the stored representation
 * and passes straight through, so an existing caller writes exactly what it
 * wrote before.
 */
function requestedGain(action: SetTrackGainAction, currentGain: number): LevelResolution {
    return resolveLevelFields(
        { linear: action.payload.gain, absoluteDb: action.payload.gainDb, deltaDb: action.payload.deltaDb },
        currentGain,
        TRACK_FADER_LAW
    );
}

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
function writtenGain(action: SetTrackGainAction, currentGain: number): number | null {
    const requested = requestedGain(action, currentGain);
    return requested.ok ? clampTrackGain(requested.linear) : null;
}

export const handleSetTrackGain = createHandler<'setTrackGain'>({
    canReapplyAfterDivergence: () => true,
    // Conflicts when `expectedGain` no longer matches the live track gain.
    // Proven by the `canReportConflict` registry honesty spec; undo step-over
    // (#2881) relies on it.
    canReportConflict: true,
    validate: (action, context) => {
        const currentGain = getPlannedTrackState(context, action.payload.trackId)?.gain;
        if (currentGain === undefined || currentGain !== action.payload.expectedGain) {
            return false;
        }
        // A request the fader law refuses must never reach a write.
        return requestedGain(action, currentGain).ok;
    },
    // A suppressed edit cannot reach the recording maps, so snapshotting and
    // restoring them on abort would only be able to discard a pass some other
    // writer legitimately owns.
    prepareAbort: (action) =>
        action.payload.automationRecordingPolicy === 'suppressed'
            ? () => undefined
            : captureAutomationRecordingRollback(),
    execute: (action) => {
        const currentGain = storedGain(action.payload.trackId);
        if (currentGain === undefined || currentGain !== action.payload.expectedGain) {
            return { status: 'conflict' };
        }
        const requested = requestedGain(action, currentGain);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        setTrackGain(action.payload.trackId, requested.linear, false, {
            automationRecordingPolicy: action.payload.automationRecordingPolicy,
        });
        return { status: 'written' };
    },
    validateSessionEntry: sessionEntryAgreesOnAutomationRecordingPolicy,
    isNoop: (action) => {
        const currentGain = storedGain(action.payload.trackId);
        if (currentGain === undefined || currentGain !== action.payload.expectedGain) {
            return false;
        }
        return currentGain === writtenGain(action, currentGain);
    },
    describe: (alpha, context) => {
        // `executeAppActionBatch` calls every action's `describe` before any
        // `execute` runs, so a second `setTrackGain` in the same batch must
        // predict from what the FIRST one will leave the track at, not from the
        // live pre-batch gain — otherwise the inverse it builds carries an
        // `expectedGain` the batch's own sequential execution can never produce,
        // and undoing the group conflicts forever.
        const previousGain =
            (context
                ? getPlannedTrackState(context, alpha.payload.trackId)?.gain
                : storedGain(alpha.payload.trackId)) ?? alpha.payload.expectedGain;
        // Both replay legs inherit the forward policy: undoing or redoing a
        // static edit is still not a fader ride.
        const automationRecordingPolicy = alpha.payload.automationRecordingPolicy;
        const written = writtenGain(alpha, previousGain);
        if (written === null) {
            return { label: 'Set track gain', inverseAction: null };
        }
        // The inverse's own request goes through the writer for the same reason
        // the forward one does. `previousGain` is read raw off the store, and the
        // store can legitimately hold a value the writer would refuse by the time
        // undo runs — a request above `FADER_MAX_GAIN` stores clamped — so an
        // inverse promising the raw value restores something else and the paired
        // redo's `expectedGain` — which is this same number — then mismatches
        // and conflicts. Predicting from the writer on both legs closes that
        // rather than reasoning about how narrow the window is. Both replay legs
        // are stated linearly whatever form the forward action used: a stored
        // amplitude is exactly what an undo has to put back.
        const restored = clampTrackGain(previousGain);
        return {
            label: 'Set track gain',
            inverseAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: restored,
                    expectedGain: written,
                    ...(automationRecordingPolicy === undefined ? {} : { automationRecordingPolicy }),
                },
            },
            redoAction: {
                type: 'setTrackGain',
                payload: {
                    trackId: alpha.payload.trackId,
                    gain: written,
                    expectedGain: restored,
                    ...(automationRecordingPolicy === undefined ? {} : { automationRecordingPolicy }),
                },
            },
        };
    },
    undoable: true,
});
