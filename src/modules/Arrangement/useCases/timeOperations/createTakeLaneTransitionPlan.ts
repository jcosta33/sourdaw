import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { type TakeReKeyLaneTransition } from '../comping/takeReKeyTransition';

import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';

/**
 * The inverse-plan half of a forward take-lane transition: null when the
 * operation neither retired nor re-keyed anything, so a plan that never
 * touched take lanes stays exactly its old shape.
 *
 * `reKeyedLanes` rides the same slot (#4841): applying the plan restores the
 * captured pre-operation facets, applying the reversed plan replays the
 * post-operation ones. The key stays absent when the operation re-keyed
 * nothing, so plans and validators written before the field existed keep
 * their exact-key shape.
 */
export function createTakeLaneTransitionPlan(
    removedClipIds: readonly string[],
    retiredLanes: readonly RetiredTakeLaneSnapshot[],
    reKeyedLanes: readonly TakeReKeyLaneTransition[] = []
): TakeLaneTransitionPlan | null {
    if (retiredLanes.length === 0 && reKeyedLanes.length === 0) {
        return null;
    }
    const plan: TakeLaneTransitionPlan = {
        version: 1,
        appliedEffect: 'restore',
        removedClipIds: [...removedClipIds],
        retiredLanes: structuredClone(retiredLanes),
    };
    if (reKeyedLanes.length > 0) {
        plan.reKeyedLanes = structuredClone(reKeyedLanes);
    }
    return plan;
}
