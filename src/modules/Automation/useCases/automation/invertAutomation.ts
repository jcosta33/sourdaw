import { automationStore } from '../../stores/automationStore';

import { transformAutomationPoints } from './transformAutomationPoints';

export function invertAutomation(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) =>
            lane.id === laneId ? { ...lane, points: transformAutomationPoints(lane, { type: 'invert' }) } : lane
        ),
    });
}
