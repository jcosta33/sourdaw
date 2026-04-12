import { automationStore } from '../../stores/automationStore';

export function stretchAutomationTime(laneId: string, factor: number, anchorBeat = 0): void {
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
                points: lane.points
                    .map((p) => ({
                        ...p,
                        beat: Math.max(0, anchorBeat + (p.beat - anchorBeat) * factor),
                    }))
                    .sort((a, b) => a.beat - b.beat),
            };
        }),
    });
}
