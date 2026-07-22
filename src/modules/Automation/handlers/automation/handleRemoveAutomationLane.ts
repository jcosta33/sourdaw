import { createHandler } from '#/utils/createHandler';

import { removeAutomationLane } from '../../useCases/automation/removeAutomationLane';

/**
 * Inverse-action handler for `addAutomationLane`. Removes the lane created under
 * the exact id allocated before the original action executes.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRemoveAutomationLane = createHandler<'removeAutomationLane'>({
    execute: (action) => {
        if (!('laneId' in action.payload)) {
            return;
        }
        removeAutomationLane(action.payload.laneId);
    },
    describe: () => ({ label: 'Remove automation lane' }),
    undoable: false,
});
