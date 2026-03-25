import { automationStore } from '#/modules/Automation/stores/automationStore';
import { type AutomationPoint } from '#/modules/Automation/models/Automation';

export function addAutomationPoint(laneId: string, point: AutomationPoint): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId
                ? {
                      ...l,
                      points: [...l.points, point].sort((a, b) => a.beat - b.beat),
                  }
                : l
        ),
    });
}
