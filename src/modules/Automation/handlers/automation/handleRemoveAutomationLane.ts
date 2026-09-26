import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type AutomationLane } from '../../models/Automation';
import { removeAutomationLane } from '../../useCases/automation/removeAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function findLane(laneId: string): AutomationLane | undefined {
    return getAutomationStoreState()?.lanes.find((lane) => lane.id === laneId);
}

function getPointIdsRemovedEarlierInBatch(laneId: string, context: HandlerValidationContext | undefined): Set<string> {
    const pointIds = new Set<string>();
    for (const candidate of context?.actions.slice(0, context.actionIndex) ?? []) {
        if (
            candidate.type === 'removeAutomationPoint' &&
            candidate.payload.laneId === laneId &&
            candidate.payload.pointId !== undefined
        ) {
            pointIds.add(candidate.payload.pointId);
        }
    }
    return pointIds;
}

/**
 * Whether removing the lane takes no point with it but those earlier members of this batch remove.
 * Undoing a batch that created the lane removes the points that batch wrote ahead of the lane
 * itself, so any point still left is someone else's edit and must survive the undo.
 */
function holdsOnlyPointsRemovedEarlierInBatch(
    lane: AutomationLane,
    context: HandlerValidationContext | undefined
): boolean {
    const removedPointIds = getPointIdsRemovedEarlierInBatch(lane.id, context);
    return lane.points.every((point) => point.id !== undefined && removedPointIds.has(point.id));
}

/** Whether the removal may run: the lane is already gone, or it holds nothing the batch leaves behind. */
function canRemoveLane(laneId: string, context: HandlerValidationContext | undefined): boolean {
    const lane = findLane(laneId);
    return lane === undefined || holdsOnlyPointsRemovedEarlierInBatch(lane, context);
}

/**
 * Inverse-action handler for `addAutomationLane`. Removes the lane created under
 * the exact id allocated before the original action executes.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 *
 * The lane is addressed by that exact id, so reapplying the removal after the
 * project diverged can only ever remove the lane it was issued for. A lane that
 * is already gone leaves nothing to undo: the removal is a no-op, so undo
 * consumes it instead of wedging history on it. A lane still holding a point
 * someone else added is a conflict: the removal writes nothing and the undo is
 * reported, because removing it would take that edit with it.
 */
export const handleRemoveAutomationLane = createHandler<'removeAutomationLane'>({
    execute: (action) => {
        const lane = findLane(action.payload.laneId);
        // Dispatch stops at `isNoop` for a lane that is already gone; only a direct caller gets here.
        if (!lane) {
            return { status: 'no-write' };
        }
        if (lane.points.length > 0) {
            return { status: 'conflict' };
        }
        removeAutomationLane(lane.id);
        return { status: 'written' };
    },
    isNoop: (action) => findLane(action.payload.laneId) === undefined,
    canReportConflict: true,
    validate: (action, context) => canRemoveLane(action.payload.laneId, context),
    canReapplyAfterDivergence: (action, context) => canRemoveLane(action.payload.laneId, context),
    describe: () => ({ label: 'Remove automation lane' }),
    undoable: false,
});
