import { automationStore } from '../../stores/automationStore';

/**
 * Zoom a lane's Y-axis to fit the used value range with padding.
 */
export function zoomToUsedRange(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane || lane.points.length === 0) {
        return;
    }

    const values = lane.points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const padding = Math.max(range * 0.1, (lane.maxValue - lane.minValue) * 0.02);

    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId
                ? {
                      ...l,
                      viewMinValue: Math.max(l.minValue, min - padding),
                      viewMaxValue: Math.min(l.maxValue, max + padding),
                  }
                : l
        ),
    });
}