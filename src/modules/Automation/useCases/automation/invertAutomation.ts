import { automationStore } from '../../stores/automationStore';

export function invertAutomation(laneId: string): void {
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
                    value: lane.maxValue - (p.value - lane.minValue),
                })),
            };
        }),
    });
}
