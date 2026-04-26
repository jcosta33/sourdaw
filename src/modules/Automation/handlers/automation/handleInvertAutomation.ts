import { createHandler } from '#/utils/createHandler';

import { invertAutomation } from '../../useCases/automation/invertAutomation';

export const handleInvertAutomation = createHandler<'invertAutomation'>({
    execute: (alpha) => {
        invertAutomation(alpha.payload.laneId);
    },
    describe: () => ({ label: 'Invert automation' }),
    undoable: true,
});
