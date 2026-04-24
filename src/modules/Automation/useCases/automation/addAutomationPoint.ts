import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function addAutomationPoint(laneId: string, point: AutomationPoint): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) =>
            length.id === laneId
                ? {
                      ...length,
                      points: [...length.points, point].sort((alpha, b) => alpha.beat - b.beat),
                  }
                : length
        ),
    });
}
