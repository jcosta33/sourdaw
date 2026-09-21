import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * Put a lane object back at the index it held, leaving every other lane alone.
 *
 * The inverse of `removeTakeLane`, and a no-op when the lane — or a lane for the
 * same track — is already present: undo and redo replay against the live store, so
 * the pair must be idempotent rather than assume the state they captured. A track
 * owns one lane, because the store's readers (`getTakeLaneForTrack`, the comp
 * resolver) take the first one for a track and a second lane's takes and regions are
 * dead state. A lane a projection gave the track while this one was absent therefore
 * keeps it, the same rule `restoreTakesForClip`'s merge and every creation path
 * enforce.
 */
export function insertTakeLane(lane: TakeLane, laneIndex: number): void {
    const state = takeLaneStore.value;
    if (!state || state.lanes.some((existing) => existing.id === lane.id || existing.trackId === lane.trackId)) {
        return;
    }
    const insertAt = Math.min(laneIndex, state.lanes.length);
    takeLaneStore.set({
        lanes: [...state.lanes.slice(0, insertAt), lane, ...state.lanes.slice(insertAt)],
    });
}
