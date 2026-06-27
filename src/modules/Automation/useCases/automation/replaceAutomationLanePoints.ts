import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

type ReplaceAutomationLanePointsInput = {
    laneId: string;
    points: AutomationPoint[];
};

export function replaceAutomationLanePoints(input: ReplaceAutomationLanePointsInput): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const points = input.points.map((point) => ({ ...point }));
    automationStore.set({
        lanes: state.lanes.map((lane) => (lane.id === input.laneId ? { ...lane, points } : lane)),
    });
}
