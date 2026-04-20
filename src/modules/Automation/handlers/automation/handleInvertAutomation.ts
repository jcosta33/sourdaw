import { createHandler } from '#/utils/createHandler';

import { invertAutomation } from '../../useCases/automation/invertAutomation';

export const handleInvertAutomation = createHandler<'invertAutomation'>({
    execute: (a) => {
        invertAutomation(a.payload.laneId);
    },
    describe: () => ({ label: 'Invert automation' }),
    undoable: true,
});
