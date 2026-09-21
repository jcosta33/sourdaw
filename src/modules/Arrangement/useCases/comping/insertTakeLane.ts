import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { laneTrackExists } from './laneTrackExists';
import { reconcileLane } from './reconcileLane';
import { takesWithLiveClips } from './takesWithLiveClips';

/**
 * Put a lane object back at the index it held, leaving every other lane alone.
 *
 * The inverse of `removeTakeLane`, and a no-op when the lane — or a lane for the
 * same track — is already there holding what this replay would add: undo and redo
 * replay against the live store, so the pair must be idempotent rather than assume
 * the state they captured. A track owns one lane, because the store's readers
 * (`getTakeLaneForTrack`, the comp resolver) take the first one for a track and a
 * second lane's takes and regions are dead state. A lane a projection gave the
 * track while this one was absent therefore keeps the track, and the lane being put
 * back merges into it through `reconcileLane` — the same reconcile
 * `restoreTakesForClip` uses, so the two cannot drift about what a replayed lane
 * may re-add. Declining instead would drop the takes and regions this lane carries,
 * which is the retirement this work exists to undo.
 *
 * A lane whose own track is gone is not placed at all: it has no host, and
 * re-inserting it strands the lane and everything it carries — the orphan this
 * work exists to prevent.
 */
export function insertTakeLane(lane: TakeLane, laneIndex: number): void {
    const state = takeLaneStore.value;
    if (!state || !laneTrackExists(lane.trackId)) {
        return;
    }

    const existingIndex = state.lanes.findIndex(
        (existing) => existing.id === lane.id || existing.trackId === lane.trackId
    );
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
        lanes: [...state.lanes.slice(0, insertAt), lane, ...state.lanes.slice(insertAt)],
    });
}
