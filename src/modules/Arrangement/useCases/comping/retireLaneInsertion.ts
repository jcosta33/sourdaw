import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { removeTakeLane } from './removeTakeLane';
import { resolveTakeLaneIndex } from './resolveTakeLaneIndex';

/**
 * Retire the takes a replayed lane insertion put back.
 *
 * The inverse of what `insertTakeLane` did for this capture. The undo put the captured
 * lane back — merged into the track's lane when a projection had given the track one —
 * and the redo takes exactly what that insertion placed away again, recomputed from the
 * entry's own captured take ids.
 *
 * A lane the track already owned carries the insertion among its own takes: only the
 * takes the capture names and the comp regions naming them leave it, that lane's own
 * takes and comps were never this replay's to retire, and the lane goes only if nothing
 * else lives in it. A lane still carrying the capture's own id is the one the undo
 * placed, but it is not the insertion's to erase wholesale either (#4556): a take
 * authored after the undo lands on the lane the track owns — which is this one — so the
 * same captured ids decide what leaves, and that take survives the redo. The placed lane
 * goes once nothing beyond the capture lives in it, the state the forward operation
 * left, because the undo raised that vessel itself; it stands untouched when it holds
 * only later state the capture does not name.
 *
 * Regions naming a retired take leave with it, whatever authored them. A region naming a
 * take the lane does not hold still advances the comp resolver's gap cursor over its
 * span, so the track's own material goes silent there.
 */
export function retireLaneInsertion(lane: TakeLane): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    const landedIndex = resolveTakeLaneIndex(state.lanes, lane);
    if (landedIndex === -1) {
        return;
    }
    const landed = state.lanes[landedIndex]!;
    const retiredTakeIds = new Set(lane.takes.map((take) => take.id));

    if (landed.id === lane.id) {
        const takes = landed.takes.filter((take) => !retiredTakeIds.has(take.id));
        const activeCompRegions = landed.activeCompRegions.filter((region) => !retiredTakeIds.has(region.takeId));
        if (takes.length === 0 && activeCompRegions.length === 0) {
            removeTakeLane(landed.id);
            return;
        }
        if (takes.length === landed.takes.length && activeCompRegions.length === landed.activeCompRegions.length) {
            return;
        }
        const lanes = [...state.lanes];
        lanes[landedIndex] = { ...landed, takes, activeCompRegions };
        takeLaneStore.set({ lanes });
        return;
    }

    const takes = landed.takes.filter((take) => !retiredTakeIds.has(take.id));
    if (takes.length === landed.takes.length) {
        return;
    }
    const activeCompRegions = landed.activeCompRegions.filter((region) => !retiredTakeIds.has(region.takeId));
    if (takes.length === 0 && activeCompRegions.length === 0) {
        removeTakeLane(landed.id);
        return;
    }

    const lanes = [...state.lanes];
    lanes[landedIndex] = { ...landed, takes, activeCompRegions };
    takeLaneStore.set({ lanes });
}
