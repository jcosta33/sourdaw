import { automationStore } from '../../stores/automationStore';

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
