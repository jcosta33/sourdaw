import { automationStore } from '../../stores/automationStore';

/**
 * Find all points within a rectangular region (beat range + value range).
 */
export function selectPointsInRange(
    laneId: string,
    beatStart: number,
    beatEnd: number,
    valueMin: number,
    valueMax: number
): number[] {
    const state = automationStore.value;
    if (!state) {
        return [];
    }

    const lane = state.lanes.find((length) => length.id === laneId);
    if (!lane) {
        return [];
    }

    const minBeat = Math.min(beatStart, beatEnd);
    const maxBeat = Math.max(beatStart, beatEnd);
    const minVal = Math.min(valueMin, valueMax);
    const maxVal = Math.max(valueMin, valueMax);

    return lane.points
        .filter((param) => param.beat >= minBeat && param.beat <= maxBeat && param.value >= minVal && param.value <= maxVal)
        .map((param) => param.beat);
}
