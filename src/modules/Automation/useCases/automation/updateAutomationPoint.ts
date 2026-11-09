import { automationStore } from '../../stores/automationStore';

export function updateAutomationPoint(
    laneId: string,
    beat: number,
    newValue: number,
    newBeat?: number,
    pointId?: string
): void {
    const state = automationStore.value;
    const lanes = state?.lanes.filter((lane) => lane.id === laneId);
    if (!state || lanes?.length !== 1) {
        return;
    }
    const lane = lanes[0];
    if (!lane) {
        return;
    }
    const candidates = lane.points.filter((point) => {
        if (pointId !== undefined) {
            return pointId.length > 0 && point.id === pointId;
        }
        return Math.abs(point.beat - beat) < 0.05;
    });
    if (candidates.length !== 1) {
        return;
    }
    const target = candidates[0];
    if (!target) {
        return;
    }
    const points = lane.points.map((point) => {
        if (point !== target) {
            return point;
        }
        return { ...point, value: newValue, beat: newBeat ?? point.beat };
    });
    automationStore.set({
        lanes: state.lanes.map((current) => {
            if (current !== lane) {
                return current;
            }
            return { ...current, points: points.sort((a, b) => a.beat - b.beat) };
        }),
    });
}
