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
        lanes: state.lanes.map((length) =>
            length.id === laneId ? { ...length, viewMinValue: undefined, viewMaxValue: undefined } : length
        ),
    });
}
