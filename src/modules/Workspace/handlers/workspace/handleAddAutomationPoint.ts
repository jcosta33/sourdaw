import { addAutomationPoint } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddAutomationPoint = createHandler<'addAutomationPoint'>({
    execute: (a) => {
        addAutomationPoint(a.payload.laneId, {
            beat: a.payload.beat,
            value: a.payload.value,
            curve: a.payload.curve ?? 'linear',
            tension: a.payload.tension ?? 0,
            stairSteps: a.payload.stairSteps,
            cp1: a.payload.cp1,
            cp2: a.payload.cp2,
        });
    },
    describe: () => ({ label: 'Add automation point' }),
    undoable: true,
});
