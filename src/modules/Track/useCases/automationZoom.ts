import { automationStore } from '../stores/automationStore';

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

/**
 * Reset Y-axis zoom to the full parameter range.
 */
export function resetYZoom(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId ? { ...l, viewMinValue: undefined, viewMaxValue: undefined } : l
        ),
    });
}

/**
 * Incrementally zoom the Y-axis in or out (positive delta = zoom in).
 */
export function adjustYZoom(laneId: string, delta: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
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
        lanes: state.lanes.map((l) =>
            l.id === laneId
                ? {
                      ...l,
                      viewMinValue: Math.max(l.minValue, center - halfRange),
                      viewMaxValue: Math.min(l.maxValue, center + halfRange),
                  }
                : l
        ),
    });
}

/**
 * Toggle virgin territory mode for a lane.
 */
export function toggleVirginTerritory(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, virginTerritory: !l.virginTerritory } : l)),
    });
}
