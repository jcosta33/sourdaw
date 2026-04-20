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

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return;
    }

    const selected = lane.points.filter((p) => selectedBeats.includes(p.beat));
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
    for (const p of selected) {
        if (p.beat < minBeat) {
            minBeat = p.beat;
        }
        if (p.beat > maxBeat) {
            maxBeat = p.beat;
        }
        if (p.value < minVal) {
            minVal = p.value;
        }
        if (p.value > maxVal) {
            maxVal = p.value;
        }
    }

    const beatCenter = (minBeat + maxBeat) / 2;
    const valCenter = (minVal + maxVal) / 2;

    const selectedSet = new Set(selectedBeats);

    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            return {
                ...l,
                points: l.points
                    .map((p) => {
                        if (!selectedSet.has(p.beat)) {
                            return p;
                        }
                        const newBeat = (p.beat - beatCenter) * xScale + beatCenter + xOffset;
                        const newValue = (p.value - valCenter) * yScale + valCenter + yOffset;
                        return {
                            ...p,
                            beat: Math.max(0, newBeat),
                            value: Math.max(l.minValue, Math.min(l.maxValue, newValue)),
                        };
                    })
                    .sort((a, b) => a.beat - b.beat),
            };
        }),
    });
}
