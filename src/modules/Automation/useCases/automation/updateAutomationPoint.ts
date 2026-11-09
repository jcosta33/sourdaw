import { automationStore } from '../../stores/automationStore';

/** Reports a store update admission, not the deferred CRDT publication outcome. */
export function updateAutomationPoint(
    laneId: string,
    beat: number,
    newValue: number,
    newBeat?: number,
    pointId?: string
): boolean {
    const state = automationStore.value;
    const lanes = state?.lanes.filter((lane) => lane.id === laneId);
    if (!state || lanes?.length !== 1) {
        return false;
    }
    const lane = lanes[0];
    if (!lane) {
        return false;
    }
    const candidates = lane.points.filter((point) => {
        if (pointId !== undefined) {
            return pointId.length > 0 && point.id === pointId;
        }
        return Math.abs(point.beat - beat) < 0.05;
    });
    if (candidates.length !== 1) {
        return false;
    }
    const target = candidates[0];
    if (!target) {
        return false;
    }
    const destination = newBeat ?? target.beat;
    // An ID-less point must remain uniquely selectable for cancel and replay.
    if (
        pointId === undefined &&
        lane.points.some((point) => point !== target && Math.abs(point.beat - destination) < 0.05)
    ) {
        return false;
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
    return true;
}
