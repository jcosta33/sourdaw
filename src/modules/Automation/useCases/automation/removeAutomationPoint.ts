import { automationStore } from '../../stores/automationStore';

export function removeAutomationPoint(laneId: string, beat: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) =>
            length.id === laneId ? { ...length, points: length.points.filter((param) => param.beat !== beat) } : length
        ),
    });
}
