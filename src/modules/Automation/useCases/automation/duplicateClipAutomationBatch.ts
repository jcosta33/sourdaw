import { createAutomationLane, type AutomationLane } from '../../models/Automation';
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

    const committedLanes = new Set<AutomationLane>(newLanes);
    let rollbackConsumed = false;
    function rollback(): void {
        if (rollbackConsumed) {
            return;
        }
        const current = automationStore.value;
        if (!current) {
            rollbackConsumed = true;
            return;
        }
        const lanes = current.lanes.filter((lane) => !committedLanes.has(lane));
        if (lanes.length !== current.lanes.length) {
            automationStore.set({ ...current, lanes });
        }
        rollbackConsumed = true;
    }

    try {
        automationStore.set({ lanes: [...state.lanes, ...newLanes] });
    } catch (error) {
        try {
            rollback();
        } catch {
            // Preserve the original mutation failure if restoration also fails.
        }
        throw error;
    }
    return rollback;
}
