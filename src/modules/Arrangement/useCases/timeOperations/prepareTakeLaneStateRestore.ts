import { removeTakesForClips } from '../comping/removeTakesForClips';
import { restoreTakesForClip } from '../comping/restoreTakesForClip';

import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';

/**
 * Applying the enclosing plan: put the retired lanes back, or retire the
 * removed clips' takes, per `appliedEffect`. Both halves are the defensive
 * comping primitives — reconcile against live state, no-op on nothing to do —
 * so a diverged store degrades to a partial restore rather than a conflict.
 */
function applyTakeLaneTransitionPlan(plan: TakeLaneTransitionPlan): boolean {
    if (plan.appliedEffect === 'restore') {
        restoreTakesForClip(plan.retiredLanes);
        return true;
    }
    removeTakesForClips(plan.removedClipIds);
    return true;
}

/** Compensation for a partially published transaction: the opposite of apply. */
function revertTakeLaneTransitionPlan(plan: TakeLaneTransitionPlan): boolean {
    if (plan.appliedEffect === 'restore') {
        removeTakesForClips(plan.removedClipIds);
        return true;
    }
    restoreTakesForClip(plan.retiredLanes);
    return true;
}

/**
 * Take lanes join the transaction last in both scopes: the restore direction
 * needs the clips back on their tracks first (a lane whose track is gone, or a
 * take whose clip is gone, has nothing to resolve against and is skipped), and
 * the retire direction is order-independent. The slot is null when the forward
 * operation retired nothing, so the handle only exists when there is something
 * to do. Apply and revert are the comping module's defensive primitives, which
 * reconcile against live state rather than conflicting on it, and each is one
 * atomic store write, so a failed apply leaves nothing to recover.
 */
export function prepareTakeLaneStateRestore(plan: TakeLaneTransitionPlan): {
    name: string;
    hasChanges: boolean;
    apply: () => boolean;
    revert: () => boolean;
    recoverAfterFailedApply: () => unknown[];
} {
    return {
        name: 'Take lanes',
        hasChanges: true,
        apply: () => applyTakeLaneTransitionPlan(plan),
        revert: () => revertTakeLaneTransitionPlan(plan),
        recoverAfterFailedApply: () => [],
    };
}
