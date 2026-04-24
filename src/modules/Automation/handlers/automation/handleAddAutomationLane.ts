import { createHandler } from '#/utils/createHandler';

import { addAutomationLane } from '../../useCases/automation/addAutomationLane';

export const handleAddAutomationLane = createHandler<'addAutomationLane'>({
    execute: (action) => {
        addAutomationLane(action.payload.trackId, action.payload.parameterId, action.payload.parameterName);
    },
    describe: (action) => ({ label: `Add automation: ${action.payload.parameterName}` }),
    undoable: true,
});
