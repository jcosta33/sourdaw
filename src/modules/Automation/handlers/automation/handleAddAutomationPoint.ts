import { createHandler } from '#/utils/createHandler';

import { addAutomationPoint } from '../../useCases/automation/addAutomationPoint';

export const handleAddAutomationPoint = createHandler<'addAutomationPoint'>({
    execute: (action) => {
        addAutomationPoint(action.payload.laneId, {
            beat: action.payload.beat,
            value: action.payload.value,
            curve: action.payload.curve ?? 'linear',
            tension: action.payload.tension ?? 0,
            stairSteps: action.payload.stairSteps,
            cp1: action.payload.cp1,
            cp2: action.payload.cp2,
        });
    },
    describe: () => ({ label: 'Add automation point' }),
    undoable: true,
});
