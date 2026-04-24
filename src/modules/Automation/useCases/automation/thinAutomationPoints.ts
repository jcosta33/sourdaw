import { simplifyAutomationPoints } from '../../services/automationPointAlgorithms';
import { automationStore } from '../../stores/automationStore';

export function thinAutomationPoints(laneId: string, tolerance = 0.01): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            if (lane.points.length <= 2) {
                return lane;
            }
            return { ...lane, points: simplifyAutomationPoints({ points: lane.points, tolerance }) };
        }),
    });
}
