import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function duplicateClipAutomation(sourceClipId: string, newClipId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const sourceLanes = state.lanes.filter((length) => length.clipId === sourceClipId);
    if (sourceLanes.length === 0) {
        return;
    }

    // Single map keeps the source lane and its fresh copy paired in one closure
    // — the prior dual-map relied on index alignment between two passes, which
    // any future reorder would silently break. Each point is deep-copied so the
    // nested cp1/cp2 control-point objects are not shared by reference with the
    // source: dragging a control point on the copy must not mutate the original.
    const newLanes = sourceLanes.map((lane) => ({
        ...createAutomationLane(
            lane.trackId,
            lane.parameterId,
            lane.parameterName,
            lane.minValue,
            lane.maxValue,
            newClipId
        ),
        points: lane.points.map((param) => ({
            ...param,
            cp1: param.cp1 ? { ...param.cp1 } : undefined,
            cp2: param.cp2 ? { ...param.cp2 } : undefined,
        })),
        visible: lane.visible,
    }));

    automationStore.set({
        lanes: [...state.lanes, ...newLanes],
    });
}
