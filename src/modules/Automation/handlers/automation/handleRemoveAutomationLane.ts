import { createHandler } from '#/utils/createHandler';

import { removeAutomationLane } from '../../useCases/automation/removeAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

/**
 * Inverse-action handler for `addAutomationLane`. Removes the lane created under
 * track-scoped `(trackId, parameterId)`. The lane is identified by that pair rather than by id
 * because the generated lane id is not known when the inverse is captured
 * (pre-execute, before `addAutomationLane` runs).
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRemoveAutomationLane = createHandler<'removeAutomationLane'>({
    execute: (action) => {
        const state = getAutomationStoreState();
        if (!state) {
            return;
        }
        const lane = state.lanes.find(
            (candidate) =>
                !candidate.clipId &&
                candidate.trackId === action.payload.trackId &&
                candidate.parameterId === action.payload.parameterId
        );
        if (!lane) {
            return;
        }
        removeAutomationLane(lane.id);
    },
    describe: () => ({ label: 'Remove automation lane' }),
    undoable: false,
});
