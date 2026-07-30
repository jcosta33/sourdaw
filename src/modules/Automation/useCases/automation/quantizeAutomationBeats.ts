import { automationStore } from '../../stores/automationStore';

import { transformAutomationPoints } from './transformAutomationPoints';

export function quantizeAutomationBeats(laneId: string, gridSize: number): void {
    const state = automationStore.value;
    if (!state || !(gridSize > 0) || !Number.isFinite(gridSize)) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return { ...lane, points: transformAutomationPoints(lane, { type: 'quantize', gridSize }) };
        }),
    });
}
