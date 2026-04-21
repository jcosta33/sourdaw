import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

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
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            return {
                ...length,
                points: length.points.map((param) =>
                    Math.abs(param.beat - beat) < 0.05 ? { ...param, curve, tension } : param
                ),
            };
        }),
    });
}
