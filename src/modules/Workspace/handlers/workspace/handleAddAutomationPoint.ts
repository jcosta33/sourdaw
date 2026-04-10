import { createHandler } from '#/helpers/createHandler';
import { addAutomationPoint } from '#/modules/Automation';

export const handleAddAutomationPoint = createHandler<'addAutomationPoint'>({
    execute: (a) => {
        addAutomationPoint(a.payload.laneId, {
            beat: a.payload.beat,
            value: a.payload.value,
            curve: a.payload.curve ?? 'linear',
            tension: 0,
        });
    },
    describe: () => ({ label: 'Add automation point' }),
    undoable: true,
});
