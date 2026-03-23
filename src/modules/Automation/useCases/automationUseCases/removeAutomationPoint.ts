import { automationStore } from '#/modules/Automation/stores/automationStore';

export function removeAutomationPoint(laneId: string, beat: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId ? { ...l, points: l.points.filter((p) => p.beat !== beat) } : l
        ),
    });
}
