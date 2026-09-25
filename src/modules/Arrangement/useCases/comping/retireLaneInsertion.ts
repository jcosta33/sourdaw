import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { removeTakeLane } from './removeTakeLane';
import { resolveTakeLaneIndex } from './resolveTakeLaneIndex';

/**
 * Retire the takes a replayed lane insertion put back.
 *
 * The inverse of what `insertTakeLane` did for this capture. The undo put the captured
 * lane back — merged into the track's lane when a projection had given the track one —
 * and the redo takes exactly those takes away again.
 *
 * Which lane that is comes from `resolveTakeLaneIndex`, and what leaves depends on what
 * the resolution found. A lane still carrying the capture's own id is the lane this
 * replay placed, so the insertion is the whole lane — liveness-filtered takes included —
 * and the redo removes it, the state the forward operation left. A lane the track
 * already owned carries the insertion instead, and only the takes the capture names and
 * the comp regions naming them leave it: that lane's own takes and comps were never this
 * replay's to retire, so they stay, and the lane goes only if nothing else lives in it.
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

    if (landed.id === lane.id) {
        removeTakeLane(landed.id);
        return;
    }

    const retiredTakeIds = new Set(lane.takes.map((take) => take.id));
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
