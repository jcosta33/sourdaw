import { addAutomationLane } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddAutomationLane = createHandler<'addAutomationLane'>({
    execute: (alpha) => {
        addAutomationLane(alpha.payload.trackId, alpha.payload.parameterId, alpha.payload.parameterName);
    },
    describe: (alpha) => ({ label: `Add automation: ${alpha.payload.parameterName}` }),
    undoable: true,
});
