import { automationStore } from '../../stores/automationStore';

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
            return {
                ...lane,
                points: lane.points.map((p) => ({
                    ...p,
                    value: Math.min(lane.maxValue, Math.max(lane.minValue, anchor + (p.value - anchor) * factor)),
                })),
            };
        }),
    });
}
