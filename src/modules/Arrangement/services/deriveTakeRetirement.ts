import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { type TakeLane } from '../models/TakeLane';

type TakeRetirementInput = {
    lanes: readonly TakeLane[] | null;
    clipIds: readonly string[];
    preservedTakeIds?: ReadonlySet<string>;
    preservedLaneIds?: ReadonlySet<string>;
};

/** The live removal and prefix preflight retire the same identities and hosts. */
export function deriveTakeRetirement({ lanes, clipIds, preservedTakeIds, preservedLaneIds }: TakeRetirementInput): {
    readonly lanes: TakeLane[];
    readonly retiredLanes: readonly RetiredTakeLaneSnapshot[];
} | null {
    if (!lanes || clipIds.length === 0) {
        return null;
    }
    const retiringClipIds = new Set(clipIds);
    const nextLanes: TakeLane[] = [];
    const retiredLanes: RetiredTakeLaneSnapshot[] = [];
    let changed = false;
    for (let index = 0; index < lanes.length; index += 1) {
        const lane = lanes[index]!;
        const removedTakeIds = new Set(
            lane.takes
                .filter((take) => retiringClipIds.has(take.clipId) && !preservedTakeIds?.has(take.id))
                .map((take) => take.id)
        );
        if (removedTakeIds.size === 0) {
            nextLanes.push(lane);
            continue;
        }
        changed = true;
        retiredLanes.push({ lane: structuredClone(lane), laneIndex: index, retiredTakeIds: [...removedTakeIds] });
        const takes = lane.takes.filter((take) => !removedTakeIds.has(take.id));
        if (takes.length === 0 && !preservedLaneIds?.has(lane.id)) {
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
