import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type AutomationLane } from '../../models/Automation';
import { removeAutomationLane } from '../../useCases/automation/removeAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function findLane(laneId: string): AutomationLane | undefined {
    return getAutomationStoreState()?.lanes.find((lane) => lane.id === laneId);
}

function isCreatedEarlierInBatch(laneId: string, context: HandlerValidationContext): boolean {
    return context.actions
        .slice(0, context.actionIndex)
        .some((candidate) => candidate.type === 'addAutomationLane' && candidate.payload.laneId === laneId);
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

/**
 * Inverse-action handler for `addAutomationLane`. Removes the lane created under
 * the exact id allocated before the original action executes.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 *
 * The lane is addressed by that exact id, so reapplying the removal after the
 * project diverged can only ever remove the lane it was issued for, and only
 * while it holds no point but those its own batch removes first. A lane that is
 * already gone, or one holding a point someone else added, is a conflict: the
 * removal writes nothing and undo reports it and steps over it.
 */
export const handleRemoveAutomationLane = createHandler<'removeAutomationLane'>({
    execute: (action) => {
        const lane = findLane(action.payload.laneId);
        if (!lane || lane.points.length > 0) {
            return { status: 'conflict' };
        }
        removeAutomationLane(lane.id);
        return { status: 'written' };
    },
    canReportConflict: true,
    validate: (action, context) => {
        const lane = findLane(action.payload.laneId);
        if (!lane) {
            return isCreatedEarlierInBatch(action.payload.laneId, context);
        }
        return holdsOnlyPointsRemovedEarlierInBatch(lane, context);
    },
    // A lane not yet in the project is the one its forward batch is about to create; validation
    // refuses the removal later if it is still absent then.
    canReapplyAfterDivergence: (action, context) => {
        const lane = findLane(action.payload.laneId);
        return lane === undefined || holdsOnlyPointsRemovedEarlierInBatch(lane, context);
    },
    describe: () => ({ label: 'Remove automation lane' }),
    undoable: false,
});
