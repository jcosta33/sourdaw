import { createHandler } from '#/utils/createHandler';

import { addAutomationLane } from '../../useCases/automation/addAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

export const handleAddAutomationLane = createHandler<'addAutomationLane'>({
    execute: (action) => {
        addAutomationLane(action.payload.trackId, action.payload.parameterId, action.payload.parameterName);
    },
    // Runs PRE-execute (see executeAppAction). The inverse of adding a lane is
    // removing it, keyed by track-scoped `(trackId, parameterId)` — the generated lane id is
    // not yet known here. `addAutomationLane` bails when a lane already exists for
    // that pair, so when one is present execute is a no-op and we omit the inverse
    // rather than emit one that would delete the user's pre-existing lane on undo.
    describe: (action) => {
        const label = `Add automation: ${action.payload.parameterName}`;
        const state = getAutomationStoreState();
        const alreadyExists = state?.lanes.some(
            (lane) =>
                !lane.clipId &&
                lane.trackId === action.payload.trackId &&
                lane.parameterId === action.payload.parameterId
        );
        if (alreadyExists) {
            return { label };
        }
        return {
            label,
            inverseAction: {
                type: 'removeAutomationLane',
                payload: { trackId: action.payload.trackId, parameterId: action.payload.parameterId },
            },
        };
    },
    undoable: true,
});
