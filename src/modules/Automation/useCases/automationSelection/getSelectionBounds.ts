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

    const lane = state.lanes.find((length) => length.id === laneId);
    if (!lane) {
        return null;
    }

    const selectedSet = new Set(selectedBeats);
    const selected = lane.points.filter((param) => selectedSet.has(param.beat));
    if (selected.length === 0) {
        return null;
    }

    // Single pass: 4 prior `Math.min/max(...selected.map(...))` spreads
    // each allocated a temporary array and risked stack overflow on large
    // selections (§117.2 pattern).
    let minBeat = Infinity;
    let maxBeat = -Infinity;
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const param of selected) {
        if (param.beat < minBeat) {
            minBeat = param.beat;
        }
        if (param.beat > maxBeat) {
            maxBeat = param.beat;
        }
        if (param.value < minValue) {
            minValue = param.value;
        }
        if (param.value > maxValue) {
            maxValue = param.value;
        }
    }

    return { minBeat, maxBeat, minValue, maxValue };
}
