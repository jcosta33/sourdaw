import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function batchAddAutomationPoints(laneId: string, points: AutomationPoint[]): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            const merged = [...l.points];
            for (const pt of points) {
                const existingIdx = merged.findIndex((p) => Math.abs(p.beat - pt.beat) < 0.05);
                if (existingIdx >= 0) {
                    merged[existingIdx] = pt;
                } else {
                    merged.push(pt);
                }
            }
            return { ...l, points: merged.sort((a, b) => a.beat - b.beat) };
        }),
    });
}
