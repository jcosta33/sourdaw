import { undoHistoryStore } from '#/modules/Command/stores';
import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type ClipRippleInsertPlanSnapshot,
    type RetiredTakeLaneSnapshot,
} from '#/utils/handlerContract';

import { addClip } from '../../useCases/clip/addClip';
import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';
import { rippleInsertClip } from '../../useCases/rippleInsert/rippleInsertClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type RestoreDrawnClipAction = Extract<AppAction, { type: 'restoreDrawnClip' }>;

/**
 * The capture the paired discard recorded when it ran at undo time.
 *
 * Read from the inverse on the live future stack rather than this action's own
 * payload: the session mirror serializes the entry at commit time and parses the
 * inverse and the redo into independent objects, so a shared array on the two
 * payloads is empty whenever the entry crossed a reload. Reading the public undo
 * history store keeps the pairing out of the Command barrel. A redo invoked
 * outside the live stack — a direct call with no paired entry — has only its own
 * payload to fall back on.
 */
function pendingRetiredTakeLanes(action: RestoreDrawnClipAction): readonly RetiredTakeLaneSnapshot[] {
    for (const entry of undoHistoryStore.value?.future ?? []) {
        if (entry.kind !== 'action' || entry.redoAction !== action) {
            continue;
        }
        const inverse = entry.inverseAction;
        return inverse?.type === 'discardDrawnClip' ? (inverse.payload.retiredTakeLanes ?? []) : [];
    }
    return action.payload.retiredTakeLanes ?? [];
}

/**
 * Redo half of `drawClip`: re-creates the drawn clip and re-applies the ripple
 * plan captured at draw time. Emitted only by the `drawClip` handler's
 * `describe()` — never invoked directly. The plan is replayed verbatim so redo
 * restores exactly the forward placement regardless of the current ripple
 * preference; replaying the forward draw would re-plan against live state and
 * either miss the recorded shifts or shift clips the gesture never touched.
 */
export const handleRestoreDrawnClip = createHandler<'restoreDrawnClip'>({
    execute: (action) => {
        const clip = addClip({
            id: action.payload.clipId,
            trackId: action.payload.trackId,
            startBeat: action.payload.startBeat,
            endBeat: action.payload.endBeat,
            name: action.payload.name,
            type: action.payload.type,
        });
        if (!clip) {
            return toHandlerExecutionResult(false);
        }
        const plan: ClipRippleInsertPlanSnapshot | null = action.payload.ripplePlan;
        if (plan && plan.shiftedClips.length > 0) {
            // Fresh shift objects: the snapshot is readonly, the use case's plan is not.
            rippleInsertClip({
                trackId: action.payload.trackId,
                insertDuration: action.payload.endBeat - action.payload.startBeat,
                plan: { shiftedClips: plan.shiftedClips.map((shift) => ({ ...shift })) },
            });
        }
        // The discard captured what removing this clip id retired; the redo
        // re-created the same id, so put those takes back.
        restoreTakesForClip(pendingRetiredTakeLanes(action));
        return toHandlerExecutionResult(true);
    },
    describe: () => ({ label: 'Restore drawn clip' }),
    undoable: false,
});
