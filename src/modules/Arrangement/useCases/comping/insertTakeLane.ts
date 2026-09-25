import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { laneTrackExists } from './laneTrackExists';
import { laneWithLiveTakes } from './laneWithLiveTakes';
import { reconcileLane } from './reconcileLane';
import { resolveTakeLaneIndex } from './resolveTakeLaneIndex';
import { takesWithLiveClips } from './takesWithLiveClips';

/**
 * Put a lane object back at the index it held, leaving every other lane alone.
 *
 * The inverse of `removeTakeLane`, and a no-op when the lane — or a lane for the same
 * track — is already there holding what this replay would add: undo and redo replay
 * against the live store, so the pair must be idempotent rather than assume the state
 * they captured. A track owns one lane, because the store's readers
 * (`getTakeLaneForTrack`, the comp resolver) take the first one for a track and a second
 * lane's takes and regions are dead state. This replay enforces that — it merges into
 * the track's lane rather than placing a second one — as every route that creates a lane
 * does: `handleRestoreTrack` puts its captured lanes back through this same insert, so a
 * lane a projection gave the track while this one was absent keeps the track, and the
 * lane being put back merges into it through `reconcileLane` — the same reconcile
 * `restoreTakesForClip` uses, so the two cannot drift about what a replayed lane may
 * re-add. Declining instead would drop the takes and regions this lane carries, which is
 * the retirement this work exists to undo. The lane this resolves is also the lane the
 * paired redo retires the insertion from (`retireLaneInsertion`), which is why both
 * directions go through `resolveTakeLaneIndex` rather than the captured id.
 *
 * A lane whose own track is gone is not placed at all: it has no host, and
 * re-inserting it strands the lane and everything it carries — the orphan this
 * work exists to prevent.
 *
 * Liveness is this insert's own rule, not each caller's: the lane it places holds
 * only the takes whose clips are still in the project and only the comp regions
 * naming those takes. A take whose clip is gone has no material to resolve
 * against, and a region left behind for it still advances the resolver's gap
 * cursor over its span, silencing the track's own material there in live playback
 * and in the offline render. Both branches apply the rule — the merge through the
 * ids it may re-add, the insert through the lane it places — so a caller replaying
 * captured state cannot forget it.
 */
export function insertTakeLane(lane: TakeLane, laneIndex: number): void {
    const state = takeLaneStore.value;
    if (!state || !laneTrackExists(lane.trackId)) {
        return;
    }

    const existingIndex = resolveTakeLaneIndex(state.lanes, lane);
    if (existingIndex !== -1) {
        // A landed lane keeps its place and takes what this one would add: a take
        // whose clip is still in the project, and a comp region naming it.
        const placedTakeIds = takesWithLiveClips(lane.takes).map((take) => take.id);
        const merged = reconcileLane(state.lanes[existingIndex]!, lane, placedTakeIds);
        if (!merged) {
            return;
        }
        const lanes = [...state.lanes];
        lanes[existingIndex] = merged;
        takeLaneStore.set({ lanes });
        return;
    }

    const insertAt = Math.min(laneIndex, state.lanes.length);
    takeLaneStore.set({
        lanes: [...state.lanes.slice(0, insertAt), laneWithLiveTakes(lane), ...state.lanes.slice(insertAt)],
    });
}
