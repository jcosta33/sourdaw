import { automationStore } from '../../stores/automationStore';

/**
 * Update a point within an automation object (clip).
 * R-H1: If the object has a poolId, propagates the change to all linked instances,
 * unless they have a local override (H2).
 */
export function updateAutomationObjectPoint(
    laneId: string,
    objectId: string,
    beat: number,
    newValue: number,
    newBeat?: number
): void {
    const state = automationStore.value;
    if (!state) return;

    const sourceLane = state.lanes.find((l) => l.id === laneId);
    const sourceObj = sourceLane?.objects.find((o) => o.id === objectId);
    if (!sourceObj) return;

    const poolId = sourceObj.poolId;

    automationStore.set({
        ...state,
        lanes: state.lanes.map((lane) => ({
            ...lane,
            objects: lane.objects.map((obj) => {
                // R-H1: Propagate if object matches ID OR matches poolId and has no override
                const isTarget = obj.id === objectId;
                const isLinked = poolId && obj.poolId === poolId && !obj.overrides?.['points'];

                if (!isTarget && !isLinked) return obj;

                return {
                    ...obj,
                    points: obj.points
                        .map((p) => (p.beat === beat ? { ...p, value: newValue, beat: newBeat ?? p.beat } : p))
                        .sort((a, b) => a.beat - b.beat),
                };
            }),
        })),
    });
}
