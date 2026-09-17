import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * Drop one lane by id, leaving every other lane alone.
 *
 * The inverse of `insertTakeLane`, and a no-op when the lane is already gone,
 * so undo and redo can replay against the live store.
 */
export function removeTakeLane(laneId: string): void {
    const state = takeLaneStore.value;
    if (!state || !state.lanes.some((existing) => existing.id === laneId)) {
        return;
    }
    takeLaneStore.set({ lanes: state.lanes.filter((existing) => existing.id !== laneId) });
}
