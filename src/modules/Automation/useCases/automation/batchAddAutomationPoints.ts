import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function batchAddAutomationPoints(laneId: string, points: AutomationPoint[]): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            const merged = [...length.points];
            for (const pt of points) {
                const existingIdx = merged.findIndex((param) => Math.abs(param.beat - pt.beat) < 0.05);
                if (existingIdx >= 0) {
                    merged[existingIdx] = pt;
                } else {
                    merged.push(pt);
                }
            }
            return { ...length, points: merged.sort((alpha, b) => alpha.beat - b.beat) };
        }),
    });
}
