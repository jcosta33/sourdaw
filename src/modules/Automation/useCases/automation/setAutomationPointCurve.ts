import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function setAutomationPointCurve(
    laneId: string,
    beat: number,
    curve: AutomationPoint['curve'],
    tension?: number
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
                // A pure curve-type change (no explicit tension) must keep the
                // point's existing tension — silently resetting it to a default
                // would discard a hand-tuned curve. Only overwrite when the
                // caller passes a tension (e.g. the tension-handle drag).
                points: length.points.map((param) =>
                    Math.abs(param.beat - beat) < 0.05 ? { ...param, curve, tension: tension ?? param.tension } : param
                ),
            };
        }),
    });
}
