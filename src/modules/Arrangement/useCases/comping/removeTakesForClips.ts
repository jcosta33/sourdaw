import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

import { planTakeRetirement } from './planTakeRetirement';

/**
 * Retire every take captured for a retiring clip id, and any lane those takes
 * leave empty, in one atomic store write.
 *
 * `removeClip` clears the clip from its tracks, its MIDI data and its
 * satellite data, but the take-lane state is keyed by clip id too: a take
 * whose clip no longer exists is a comp no resolver can play, and a lane whose
 * only take named the retired clip has nothing left to hold. Comp regions
 * naming a retired take go with it, so no region can reference a take id that
 * no longer exists.
 *
 * A no-op when nothing names a retiring clip; the store is not rewritten then.
 * Returns the lanes exactly as they were before the removal, so a caller
 * restoring the removal knows what it retired.
 */
export function removeTakesForClips(clipIds: readonly string[]): readonly RetiredTakeLaneSnapshot[] {
    const plan = planTakeRetirement(clipIds);
    if (!plan) {
        return [];
    }

    takeLaneStore.set({ lanes: plan.lanes });
    return plan.retiredLanes;
}
