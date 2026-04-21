import { automationStore } from '../../stores/automationStore';

/**
 * Transform selected points by scaling and offsetting.
 * xScale/yScale are relative to the selection bounding box.
 */
export function transformSelectedPoints(
    laneId: string,
    selectedBeats: number[],
    xScale: number,
    yScale: number,
    xOffset: number,
    yOffset: number
): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((length) => length.id === laneId);
    if (!lane) {
        return;
    }

    const selected = lane.points.filter((param) => selectedBeats.includes(param.beat));
    if (selected.length === 0) {
        return;
    }

    // Compute bounding box of selection in a single pass — the prior
    // 4× `Math.min/max(...selected.map(...))` spread pattern both allocated
    // temporary arrays and risked stack overflow on large selections.
    let minBeat = Infinity;
    let maxBeat = -Infinity;
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const param of selected) {
        if (param.beat < minBeat) {
            minBeat = param.beat;
        }
        if (param.beat > maxBeat) {
            maxBeat = param.beat;
        }
        if (param.value < minVal) {
            minVal = param.value;
        }
        if (param.value > maxVal) {
            maxVal = param.value;
        }
    }

    const beatCenter = (minBeat + maxBeat) / 2;
    const valCenter = (minVal + maxVal) / 2;

    const selectedSet = new Set(selectedBeats);

    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            return {
                ...length,
                points: length.points
                    .map((param) => {
                        if (!selectedSet.has(param.beat)) {
                            return param;
                        }
                        const newBeat = (param.beat - beatCenter) * xScale + beatCenter + xOffset;
                        const newValue = (param.value - valCenter) * yScale + valCenter + yOffset;
                        return {
                            ...param,
                            beat: Math.max(0, newBeat),
                            value: Math.max(length.minValue, Math.min(length.maxValue, newValue)),
                        };
                    })
                    .sort((alpha, b) => alpha.beat - b.beat),
            };
        }),
    });
}
