import { automationStore } from '#/modules/Automation/stores/automationStore';

export function updateAutomationPoint(laneId: string, beat: number, newValue: number, newBeat?: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            const updated = l.points.map((p) =>
                p.beat === beat ? { ...p, value: newValue, beat: newBeat ?? p.beat } : p
            );
            return { ...l, points: updated.sort((a, b) => a.beat - b.beat) };
        }),
    });
}
