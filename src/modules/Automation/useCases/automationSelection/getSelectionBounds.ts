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

    // Single pass: 4 prior `Math.min/max(...selected.map(...))` spreads
    // each allocated a temporary array and risked stack overflow on large
    // selections (§117.2 pattern).
    let minBeat = Infinity;
    let maxBeat = -Infinity;
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (const p of selected) {
        if (p.beat < minBeat) minBeat = p.beat;
        if (p.beat > maxBeat) maxBeat = p.beat;
        if (p.value < minValue) minValue = p.value;
        if (p.value > maxValue) maxValue = p.value;
    }

    return { minBeat, maxBeat, minValue, maxValue };
}