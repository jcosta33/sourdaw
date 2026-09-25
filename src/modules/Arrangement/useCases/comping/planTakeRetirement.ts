import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

export type TakeRetirementPlan = {
    readonly lanes: TakeLane[];
    readonly retiredLanes: readonly RetiredTakeLaneSnapshot[];
};

/**
 * The one derivation of "which takes retiring clip ids remove, and which lanes
 * that leaves behind".
 *
 * A lane that loses no take is carried through untouched. A lane that keeps
 * takes keeps its own comp regions except those naming a take this call
 * actually removed — a region that named a take this removal did not touch
 * stays, dangling or not. A lane whose last take named a retiring clip is
 * retired whole. `retiredLanes` holds each touched lane exactly as it was
 * before the removal, with the index it held and the take ids this call
 * retired, so an undo can put back exactly those takes and no others.
 *
 * Returns null when the store is absent, no clip id was given, or no take
 * names a retiring clip.
 */
export function planTakeRetirement(clipIds: readonly string[]): TakeRetirementPlan | null {
    const state = takeLaneStore.value;
    if (!state || clipIds.length === 0) {
        return null;
    }

    const retiringClipIds = new Set(clipIds);
    const nextLanes: TakeLane[] = [];
    const retiredLanes: RetiredTakeLaneSnapshot[] = [];
    let changed = false;

    for (let index = 0; index < state.lanes.length; index += 1) {
        const lane = state.lanes[index]!;
        const removedTakeIds = new Set(
            lane.takes.filter((take) => retiringClipIds.has(take.clipId)).map((take) => take.id)
        );
        if (removedTakeIds.size === 0) {
            nextLanes.push(lane);
            continue;
        }

        changed = true;
        retiredLanes.push({ lane: structuredClone(lane), laneIndex: index, retiredTakeIds: [...removedTakeIds] });

        const takes = lane.takes.filter((take) => !removedTakeIds.has(take.id));
        // The lane lost its last take to a retiring clip: retire the lane too.
        if (takes.length === 0) {
            continue;
        }
        nextLanes.push({
            ...lane,
            takes,
            activeCompRegions: lane.activeCompRegions.filter((region) => !removedTakeIds.has(region.takeId)),
        });
    }

    return changed ? { lanes: nextLanes, retiredLanes } : null;
}
