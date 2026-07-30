import { automationStore } from '../../stores/automationStore';

import { transformAutomationPoints } from './transformAutomationPoints';

export function stretchAutomationTime(laneId: string, factor: number, anchorBeat?: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return {
                ...lane,
                points: transformAutomationPoints(lane, { type: 'stretch', factor, anchorBeat }),
            };
        }),
    });
}
