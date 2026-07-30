import { automationStore } from '../../stores/automationStore';

import { transformAutomationPoints } from './transformAutomationPoints';

export function scaleAutomationValues(laneId: string, factor: number, anchor = 0): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return { ...lane, points: transformAutomationPoints(lane, { type: 'scale', factor, anchor }) };
        }),
    });
}
