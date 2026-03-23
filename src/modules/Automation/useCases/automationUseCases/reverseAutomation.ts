import { automationStore } from '#/modules/Automation/stores/automationStore';

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
            const maxBeat = Math.max(...lane.points.map((p) => p.beat));
            return {
                ...lane,
                points: lane.points.map((p) => ({ ...p, beat: maxBeat - p.beat })).sort((a, b) => a.beat - b.beat),
            };
        }),
    });
}
