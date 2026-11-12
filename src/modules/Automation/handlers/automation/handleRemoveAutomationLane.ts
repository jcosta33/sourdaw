import { createHandler } from '#/utils/createHandler';
import { type AppAction, type AutomationPointSnapshot, type HandlerValidationContext } from '#/utils/handlerContract';

import { type AutomationLane } from '../../models/Automation';
import { removeAutomationLane } from '../../useCases/automation/removeAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { automationPointSnapshotsMatch } from './automationPointSnapshotsMatch';
import { isRemoveAutomationLanePayload } from './validateRangeWriteSessionEntries';

type RemoveAutomationLanePayload = Extract<AppAction, { type: 'removeAutomationLane' }>['payload'];
type RestoreAutomationLanePointsAction = Extract<AppAction, { type: 'restoreAutomationLanePoints' }>;

function findLane(laneId: string): AutomationLane | undefined {
    return getAutomationStoreState()?.lanes.find((lane) => lane.id === laneId);
}

/**
 * Whether the lane holds exactly what the inverse that created it says it wrote. A lane created
 * with its points is removed with them, and only while no other edit has touched them.
 */
function holdsOnlyItsCreatedPoints(
    points: readonly AutomationPointSnapshot[],
    payload: RemoveAutomationLanePayload
): boolean {
    return payload.expectedPoints !== undefined && automationPointSnapshotsMatch(points, payload.expectedPoints);
}

function isRestoreOfLane(candidate: AppAction, laneId: string): candidate is RestoreAutomationLanePointsAction {
    return candidate.type === 'restoreAutomationLanePoints' && candidate.payload.laneId === laneId;
}

/**
 * The points the lane holds when this removal runs. Undoing a batch that wrote the lane more than
 * once restores its later writes before it removes the lane, so an earlier restore of this lane in
 * the same batch leaves the points it restores, and that restore refuses on its own if the lane
 * does not hold what it expects.
 */
function getPlannedPoints(
    lane: AutomationLane,
    context: HandlerValidationContext | undefined
): readonly AutomationPointSnapshot[] {
    const restore = (context?.actions.slice(0, context.actionIndex) ?? []).findLast((candidate) =>
        isRestoreOfLane(candidate, lane.id)
    );
    return restore !== undefined && isRestoreOfLane(restore, lane.id) ? restore.payload.points : lane.points;
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
function canRemoveLane(payload: RemoveAutomationLanePayload, context: HandlerValidationContext | undefined): boolean {
    const lane = findLane(payload.laneId);
    return (
        lane === undefined ||
        holdsOnlyItsCreatedPoints(getPlannedPoints(lane, context), payload) ||
        holdsOnlyPointsRemovedEarlierInBatch(lane, context)
    );
}

/**
 * Inverse-action handler for `addAutomationLane`, and for a range write that
 * created its lane. Removes the lane created under the exact id allocated before
 * the original action executes.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 *
 * The lane is addressed by that exact id, so reapplying the removal after the
 * project diverged can only ever remove the lane it was issued for. A lane that
 * is already gone leaves nothing to undo: the removal is a no-op, so undo
 * consumes it instead of wedging history on it. A lane still holding a point
 * someone else added is a conflict: the removal writes nothing and the undo is
 * reported, because removing it would take that edit with it. A lane its creator
 * wrote points into is removed with exactly those points, and with nothing else.
 */
export const handleRemoveAutomationLane = createHandler<'removeAutomationLane'>({
    execute: (action) => {
        const lane = findLane(action.payload.laneId);
        // Dispatch stops at `isNoop` for a lane that is already gone; only a direct caller gets here.
        if (!lane) {
            return { status: 'no-write' };
        }
        if (lane.points.length > 0 && !holdsOnlyItsCreatedPoints(lane.points, action.payload)) {
            return { status: 'conflict' };
        }
        removeAutomationLane(lane.id);
        return { status: 'written' };
    },
    isNoop: (action) => findLane(action.payload.laneId) === undefined,
    canReportConflict: true,
    validate: (action, context) => canRemoveLane(action.payload, context),
    canReapplyAfterDivergence: (action, context) => canRemoveLane(action.payload, context),
    describe: () => ({ label: 'Remove automation lane' }),
    // The removal writes only the automation store, which an aborted batch's transaction rolls
    // back with every other member; there is no runtime state to compensate for. A group undo that
    // removes one lane before a later member conflicts therefore reports that conflict and keeps
    // the whole group on the stack.
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    validateSessionActionArguments: isRemoveAutomationLanePayload,
    undoable: false,
});
