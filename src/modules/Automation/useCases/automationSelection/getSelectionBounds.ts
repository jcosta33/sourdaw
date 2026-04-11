import { automationStore } from '../../stores/automationStore';

/**
 * Get the bounding box of selected points.
 */
export function getSelectionBounds(
    laneId: string,
    selectedBeats: number[]
): { minBeat: number; maxBeat: number; minValue: number; maxValue: number } | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return null;
    }

    const selectedSet = new Set(selectedBeats);
    const selected = lane.points.filter((p) => selectedSet.has(p.beat));
    if (selected.length === 0) {
        return null;
    }

    return {
        minBeat: Math.min(...selected.map((p) => p.beat)),
        maxBeat: Math.max(...selected.map((p) => p.beat)),
        minValue: Math.min(...selected.map((p) => p.value)),
        maxValue: Math.max(...selected.map((p) => p.value)),
    };
}