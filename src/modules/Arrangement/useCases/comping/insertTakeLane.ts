import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * Put a lane object back at the index it held, leaving every other lane alone.
 *
 * The inverse of `removeTakeLane`, and a no-op when the lane is already
 * present: undo and redo replay against the live store, so the pair must be
 * idempotent rather than assume the state they captured.
 */
export function insertTakeLane(lane: TakeLane, laneIndex: number): void {
    const state = takeLaneStore.value;
    if (!state || state.lanes.some((existing) => existing.id === lane.id)) {
        return;
    }
    const insertAt = Math.min(laneIndex, state.lanes.length);
    takeLaneStore.set({
        lanes: [...state.lanes.slice(0, insertAt), lane, ...state.lanes.slice(insertAt)],
    });
}
