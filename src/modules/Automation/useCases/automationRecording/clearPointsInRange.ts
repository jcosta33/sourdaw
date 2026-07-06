import { automationStore } from '../../stores/automationStore';

export function clearPointsInRange(laneId: string, fromBeat: number, toBeat: number): void {
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
                points: lane.points.filter((param) => param.beat < fromBeat || param.beat > toBeat),
            };
        }),
    });
}
