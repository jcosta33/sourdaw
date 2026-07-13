import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

type DuplicateClipAutomationBatchInput = {
    copies: readonly { sourceClipId: string; targetClipId: string; targetTrackId: string }[];
};

export function duplicateClipAutomationBatch({ copies }: DuplicateClipAutomationBatchInput): () => void {
    if (copies.length === 0) {
        return () => undefined;
    }

    const state = automationStore.value;
    if (!state) {
        return () => undefined;
    }

    const newLanes = copies.flatMap(({ sourceClipId, targetClipId, targetTrackId }) =>
        state.lanes
            .filter((lane) => lane.clipId === sourceClipId)
            .map((lane) => ({
                ...createAutomationLane(
                    targetTrackId,
                    lane.parameterId,
                    lane.parameterName,
                    lane.minValue,
                    lane.maxValue,
                    targetClipId
                ),
                points: lane.points.map((point) => ({
                    ...point,
                    cp1: point.cp1 ? { ...point.cp1 } : undefined,
                    cp2: point.cp2 ? { ...point.cp2 } : undefined,
                })),
                visible: lane.visible,
            }))
    );

    if (newLanes.length === 0) {
        return () => undefined;
    }

    try {
        automationStore.set({ lanes: [...state.lanes, ...newLanes] });
    } catch (error) {
        try {
            automationStore.set(state);
        } catch {
            // Preserve the original mutation failure if restoration also fails.
        }
        throw error;
    }
    return () => {
        automationStore.set(state);
    };
}
