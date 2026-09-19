import { resolveLevelFields, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { MAX_MASTER_GAIN } from '../../stores/transportStore';

/**
 * Folds every prior `setMasterGain` or `restoreMasterGain` action in this batch
 * onto the live master percent. `executeAppActionBatch` calls every action's
 * `describe`, then every action's `validate`, before any `execute` runs, so a
 * second action touching the master fader in the same batch — including a
 * grouped undo's own atomic replay of two `restoreMasterGain` inverses — must
 * predict from what an earlier one will leave the fader at, not from the live
 * pre-batch percent, or the inverse or guard it builds carries an
 * `expectedPercent` the batch's own sequential execution can never produce,
 * mirroring why `projectTrackThroughPriorBatchActions` exists for track-scoped
 * writes.
 */
export function projectMasterGainThroughPriorBatchActions(
    livePercent: number,
    context: HandlerValidationContext
): number {
    let projected = livePercent;
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.type === 'restoreMasterGain') {
            // A restore writes the replacement percent directly, with no law to
            // resolve against.
            projected = action.payload.replacementPercent;
            continue;
        }
        if (action.type !== 'setMasterGain') {
            continue;
        }
        const resolved = resolveLevelFields(
            { linear: action.payload.gain, absoluteDb: action.payload.gainDb, deltaDb: action.payload.deltaDb },
            projected / 100,
            TRACK_FADER_LAW
        );
        if (resolved.ok) {
            // `replaceMasterGain` refuses a percent outside `[0, MAX_MASTER_GAIN]`
            // rather than storing it, so the projection bounds the same way — a
            // later action's `deltaDb` in this batch must measure from a percent
            // the store could actually hold.
            projected = Math.max(0, Math.min(MAX_MASTER_GAIN, resolved.linear * 100));
        }
    }
    return projected;
}
