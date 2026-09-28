import { applyTakeReKeyTransitions } from '../comping/applyTakeReKeyTransitions';
import { removeTakesForClips } from '../comping/removeTakesForClips';
import { restoreTakeReKeyTransitions } from '../comping/restoreTakeReKeyTransitions';
import { restoreTakesForClip } from '../comping/restoreTakesForClip';

import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';

/**
 * Applying the enclosing plan: put the captured lanes back, or re-apply the
 * forward transition, per `appliedEffect`. The restore direction restores the
 * retired lanes and un-re-keys the re-keyed ones; the retire direction retires
 * the removed clips' takes and replays the re-key. All four halves are the
 * defensive comping primitives — reconcile against live state, no-op on
 * nothing to do — so a diverged store degrades to a partial restore rather
 * than a conflict. Retirement and re-key move disjoint takes (a removed clip's
 * takes are verbatim in both re-key sides), so the two legs of one direction
 * cannot interfere.
 */
function applyTakeLaneTransitionPlan(plan: TakeLaneTransitionPlan): boolean {
    if (plan.appliedEffect === 'restore') {
        restoreTakesForClip(plan.retiredLanes);
        restoreTakeReKeyTransitions(plan.reKeyedLanes ?? []);
        return true;
    }
    removeTakesForClips(plan.removedClipIds);
    applyTakeReKeyTransitions(plan.reKeyedLanes ?? []);
    return true;
}

/** Compensation for a partially published transaction: the opposite of apply. */
function revertTakeLaneTransitionPlan(plan: TakeLaneTransitionPlan): boolean {
    if (plan.appliedEffect === 'restore') {
        removeTakesForClips(plan.removedClipIds);
        applyTakeReKeyTransitions(plan.reKeyedLanes ?? []);
        return true;
    }
    restoreTakesForClip(plan.retiredLanes);
    restoreTakeReKeyTransitions(plan.reKeyedLanes ?? []);
    return true;
}

/**
 * Take lanes join the transaction last in both scopes: the restore direction
 * needs the clips back on their tracks first (a lane whose track is gone, or a
 * take whose clip is gone, has nothing to resolve against and is skipped), and
 * the retire direction is order-independent. The slot is null when the forward
 * operation neither retired nor re-keyed takes, so the handle only exists when
 * there is something to do. Apply and revert are the comping module's
 * defensive primitives, which reconcile against live state rather than
 * conflicting on it, and each is one atomic store write, so a failed apply
 * leaves nothing to recover. The retirement leg always runs before the re-key
 * leg: a region the retirement owns rides only the re-key's before side
 * (#4841), so on the restore direction the re-key leg re-adds it only after
 * the survivor's region has moved off its span.
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
