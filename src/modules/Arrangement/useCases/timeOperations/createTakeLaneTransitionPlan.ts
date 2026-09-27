import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';

/**
 * The inverse-plan half of a forward retirement: null when the removal retired
 * nothing, so a plan that never touched take lanes stays exactly its old shape.
 */
export function createTakeLaneTransitionPlan(
    removedClipIds: readonly string[],
    retiredLanes: readonly RetiredTakeLaneSnapshot[]
): TakeLaneTransitionPlan | null {
    if (retiredLanes.length === 0) {
        return null;
    }
    return {
        version: 1,
        appliedEffect: 'restore',
        removedClipIds: [...removedClipIds],
        retiredLanes: structuredClone(retiredLanes),
    };
}
