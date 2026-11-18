import { type AutomationPoint } from '../../models/Automation';
import { insertAutomationPointAtBeat } from '../../services/insertAutomationPointAtBeat';
import { automationStore } from '../../stores/automationStore';

export function addAutomationPoint(laneId: string, point: AutomationPoint): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            return { ...length, points: insertAutomationPointAtBeat(length.points, point) };
        }),
    });
}
