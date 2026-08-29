import { buildDuplicatedLane } from '../../services/buildDuplicatedLane';
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
            .map((lane) => buildDuplicatedLane(lane, targetTrackId, targetClipId))
    );

    if (newLanes.length === 0) {
        return () => undefined;
    }

    // The rollback matches lanes by id, not object identity: a CRDT hydrate
    // reseats every store object onto a fresh instance (same ids, new
    // references), so an identity-keyed filter would silently no-op after a
    // reseat and leave the rolled-back batch in the project.
    const committedLaneIds = new Set(newLanes.map((lane) => lane.id));
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
        const lanes = current.lanes.filter((lane) => !committedLaneIds.has(lane.id));
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
