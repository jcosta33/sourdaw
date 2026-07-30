import { automationStore } from '../../stores/automationStore';

import { transformAutomationPoints } from './transformAutomationPoints';

export function thinAutomationPoints(laneId: string, tolerance = 0.01): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return { ...lane, points: transformAutomationPoints(lane, { type: 'thin', tolerance }) };
        }),
    });
}
