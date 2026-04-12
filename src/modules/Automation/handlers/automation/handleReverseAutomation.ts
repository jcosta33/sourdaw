import { createHandler } from '#/utils/createHandler';
import { reverseAutomation } from '../../useCases/automation/reverseAutomation';

export const handleReverseAutomation = createHandler<'reverseAutomation'>({
    execute: (a) => {
        reverseAutomation(a.payload.laneId);
    },
    describe: () => ({ label: 'Reverse automation' }),
    undoable: true,
});
