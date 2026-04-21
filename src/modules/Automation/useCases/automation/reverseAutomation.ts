import { automationStore } from '../../stores/automationStore';

export function reverseAutomation(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            if (lane.points.length === 0) {
                return lane;
            }
            const maxBeat = Math.max(...lane.points.map((param) => param.beat));
            return {
                ...lane,
                points: lane.points.map((param) => ({ ...param, beat: maxBeat - param.beat })).sort((alpha, b) => alpha.beat - b.beat),
            };
        }),
    });
}
