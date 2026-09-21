import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * Put back the take-lane state a clip removal retired, in one atomic store
 * write.
 *
 * Each entry is a lane exactly as it stood before the removal, at the index it
 * held: a lane that survived with fewer takes is rewritten from its captured
 * state, and a lane retired whole is re-inserted where it was. Every other
 * lane is left alone, so takes and comp regions belonging to clips that never
 * left survive the undo. A no-op when the store is absent or nothing was
 * retired.
 */
export function restoreTakesForClip(retiredLanes: readonly RetiredTakeLaneSnapshot[]): void {
    const state = takeLaneStore.value;
    if (!state || retiredLanes.length === 0) {
        return;
    }

    const lanes = [...state.lanes];
    for (const { lane, laneIndex } of retiredLanes) {
        const existingIndex = lanes.findIndex((candidate) => candidate.id === lane.id);
        if (existingIndex === -1) {
            lanes.splice(Math.min(Math.max(laneIndex, 0), lanes.length), 0, structuredClone(lane));
            continue;
        }
        lanes[existingIndex] = structuredClone(lane);
    }

    takeLaneStore.set({ lanes });
}
