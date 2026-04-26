import { automationStore } from '../../stores/automationStore';

/**
 * Incrementally zoom the Y-axis in or out (positive delta = zoom in).
 */
export function adjustYZoom(laneId: string, delta: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((length) => length.id === laneId);
    if (!lane) {
        return;
    }

    const currentMin = lane.viewMinValue ?? lane.minValue;
    const currentMax = lane.viewMaxValue ?? lane.maxValue;
    const range = currentMax - currentMin;
    const center = (currentMin + currentMax) / 2;
    const factor = 1 - delta * 0.1; // positive delta = zoom in (shrink range)
    const newRange = Math.max(range * factor, (lane.maxValue - lane.minValue) * 0.05);
    const halfRange = newRange / 2;

    automationStore.set({
        lanes: state.lanes.map((length) =>
            length.id === laneId
                ? {
                      ...length,
                      viewMinValue: Math.max(length.minValue, center - halfRange),
                      viewMaxValue: Math.min(length.maxValue, center + halfRange),
                  }
                : length
        ),
    });
}
