import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { removeAutomationLane } from '../../useCases/automation/removeAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function isLaneInProject(laneId: string): boolean {
    return getAutomationStoreState()?.lanes.some((lane) => lane.id === laneId) === true;
}

function isCreatedEarlierInBatch(laneId: string, context: HandlerValidationContext): boolean {
    return context.actions
        .slice(0, context.actionIndex)
        .some((candidate) => candidate.type === 'addAutomationLane' && candidate.payload.laneId === laneId);
}

/**
 * Inverse-action handler for `addAutomationLane`. Removes the lane created under
 * the exact id allocated before the original action executes.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 *
 * The lane is addressed by that exact id, so reapplying the removal after the
 * project diverged can only ever remove the lane it was issued for; validation
 * admits it while the lane is in the project or an earlier member of the same
 * batch creates it.
 */
export const handleRemoveAutomationLane = createHandler<'removeAutomationLane'>({
    execute: (action) => {
        removeAutomationLane(action.payload.laneId);
    },
    validate: (action, context) =>
        isLaneInProject(action.payload.laneId) || isCreatedEarlierInBatch(action.payload.laneId, context),
    canReapplyAfterDivergence: () => true,
    describe: () => ({ label: 'Remove automation lane' }),
    undoable: false,
});
