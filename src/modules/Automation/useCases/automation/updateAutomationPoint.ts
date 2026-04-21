import { automationStore } from '../../stores/automationStore';

export function updateAutomationPoint(laneId: string, beat: number, newValue: number, newBeat?: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            const updated = length.points.map((param) =>
                param.beat === beat ? { ...param, value: newValue, beat: newBeat ?? param.beat } : param
            );
            return { ...length, points: updated.sort((alpha, b) => alpha.beat - b.beat) };
        }),
    });
}
