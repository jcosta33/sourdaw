import { type AudioSourceTile } from '#/utils/audioSourceTime';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

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
 * stays, dangling or not. By default, a lane whose last take named a retiring
 * clip is retired whole. `retiredLanes` holds each touched lane exactly as it was
 * before the removal, with the index it held and the take ids this call
 * retired, so an undo can put back exactly those takes and no others.
 *
 * Returns null when the store is absent, no clip id was given, or no take
 * names a retiring clip.
 * A joined re-key transition can preserve its captured identities here so
 * that it remains their sole owner, including when they are a lane's last takes.
 * Time replay can preserve specified empty lane hosts when it owns only
 * disappearing clip facets, rather than those live lanes themselves.
 */
export function planTakeRetirement(
    clipIds: readonly string[],
    preservedTakeIds?: ReadonlySet<string>,
    options?: {
        readonly preservedLaneIds?: ReadonlySet<string>;
        readonly preservedBaseGapAudioSources?: readonly AudioSourceTile[];
    }
): TakeRetirementPlan | null {
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
            lane.takes
                .filter((take) => retiringClipIds.has(take.clipId) && !preservedTakeIds?.has(take.id))
                .map((take) => take.id)
        );
        const removesTile = (tile: AudioSourceTile) =>
            retiringClipIds.has(tile.clipId) &&
            !options?.preservedBaseGapAudioSources?.some((owned) => valuesEqual(owned, tile));
        const removedTiles = lane.baseGapAudioSources?.filter(removesTile) ?? [];
        if (removedTakeIds.size === 0 && removedTiles.length === 0) {
            nextLanes.push(lane);
            continue;
        }

        changed = true;
        const retiredLane: {
            lane: RetiredTakeLaneSnapshot['lane'];
            laneIndex: number;
            retiredTakeIds: string[];
            retiredBaseGapAudioSources?: AudioSourceTile[];
        } = {
            lane: structuredClone(lane),
            laneIndex: index,
            retiredTakeIds: [...removedTakeIds],
        };
        if (removedTiles.length > 0) {
            retiredLane.retiredBaseGapAudioSources = structuredClone(removedTiles);
        }
        retiredLanes.push(retiredLane);

        const takes = lane.takes.filter((take) => !removedTakeIds.has(take.id));
        const gaps = lane.baseGapAudioSources?.filter((tile) => !removesTile(tile));
        if (takes.length === 0 && !gaps?.length && !options?.preservedLaneIds?.has(lane.id)) {
            continue;
        }
        const nextLane = {
            ...lane,
            takes,
            activeCompRegions: lane.activeCompRegions.filter((region) => !removedTakeIds.has(region.takeId)),
        };
        if (gaps !== undefined) {
            nextLane.baseGapAudioSources = gaps;
        }
        nextLanes.push(nextLane);
    }

    return changed ? { lanes: nextLanes, retiredLanes } : null;
}
