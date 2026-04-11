import { automationStore } from '../../stores/automationStore';

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