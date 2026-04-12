import { automationStore } from '../../stores/automationStore';
import { type AutomationPoint } from '../../models/Automation';

export function setAutomationPointCurve(
    laneId: string,
    beat: number,
    curve: AutomationPoint['curve'],
    tension = 0.5
): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            return {
                ...l,
                points: l.points.map((p) => (Math.abs(p.beat - beat) < 0.05 ? { ...p, curve, tension } : p)),
            };
        }),
    });
}
