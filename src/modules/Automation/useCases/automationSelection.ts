import { inject } from '#/infra/di/inject';
import { automationStore } from '../stores/automationStore';
import { pushUndoEntry } from '#/modules/Command/useCases';

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

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return [];
    }

    const minBeat = Math.min(beatStart, beatEnd);
    const maxBeat = Math.max(beatStart, beatEnd);
    const minVal = Math.min(valueMin, valueMax);
    const maxVal = Math.max(valueMin, valueMax);

    return lane.points
        .filter((p) => p.beat >= minBeat && p.beat <= maxBeat && p.value >= minVal && p.value <= maxVal)
        .map((p) => p.beat);
}

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

    // Compute bounding box of selection
    const minBeat = Math.min(...selected.map((p) => p.beat));
    const maxBeat = Math.max(...selected.map((p) => p.beat));
    const minVal = Math.min(...selected.map((p) => p.value));
    const maxVal = Math.max(...selected.map((p) => p.value));

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

/**
 * Delete selected points with undo support.
 */
export function deleteSelectedPoints(laneId: string, selectedBeats: number[]): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return;
    }

    const selectedSet = new Set(selectedBeats);
    const deletedPoints = lane.points.filter((p) => selectedSet.has(p.beat));
    const remainingPoints = lane.points.filter((p) => !selectedSet.has(p.beat));

    automationStore.set({
        lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, points: remainingPoints } : l)),
    });

    pushUndoEntry(
        'Delete automation points',
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) => {
                    if (l.id !== laneId) {
                        return l;
                    }
                    const merged = [...l.points, ...deletedPoints].sort((a, b) => a.beat - b.beat);
                    return { ...l, points: merged };
                }),
            });
        },
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) =>
                    l.id === laneId ? { ...l, points: l.points.filter((p) => !selectedSet.has(p.beat)) } : l
                ),
            });
        }
    );
}

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
