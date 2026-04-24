import { addAutomationPoint } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddAutomationPoint = createHandler<'addAutomationPoint'>({
    execute: (alpha) => {
        addAutomationPoint(alpha.payload.laneId, {
            beat: alpha.payload.beat,
            value: alpha.payload.value,
            curve: alpha.payload.curve ?? 'linear',
            tension: alpha.payload.tension ?? 0,
            stairSteps: alpha.payload.stairSteps,
            cp1: alpha.payload.cp1,
            cp2: alpha.payload.cp2,
        });
    },
    describe: () => ({ label: 'Add automation point' }),
    undoable: true,
});
