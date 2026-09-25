import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { planTakeRetirement } from './planTakeRetirement';

/**
 * Read-only half of `removeTakesForClips`, for a removal handler's
 * `describe()`: captures exactly the lanes the removal would retire, without
 * writing, so the inverse it puts on the undo entry restores what the forward
 * path removes.
 */
export function captureRetiredTakeLanes(clipIds: readonly string[]): readonly RetiredTakeLaneSnapshot[] {
    return planTakeRetirement(clipIds)?.retiredLanes ?? [];
}
