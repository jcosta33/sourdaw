import { createHandler } from '#/utils/createHandler';

import { reverseAutomation } from '../../useCases/automation/reverseAutomation';

export const handleReverseAutomation = createHandler<'reverseAutomation'>({
    execute: (alpha) => {
        reverseAutomation(alpha.payload.laneId);
    },
    describe: () => ({ label: 'Reverse automation' }),
    undoable: true,
});
