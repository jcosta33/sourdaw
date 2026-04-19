import { createHandler } from '#/utils/createHandler';
import { addAutomationLane } from '#/modules/Automation/useCases';

export const handleAddAutomationLane = createHandler<'addAutomationLane'>({
    execute: (a) => {
        addAutomationLane(a.payload.trackId, a.payload.parameterId, a.payload.parameterName);
    },
    describe: (a) => ({ label: `Add automation: ${a.payload.parameterName}` }),
    undoable: true,
});
