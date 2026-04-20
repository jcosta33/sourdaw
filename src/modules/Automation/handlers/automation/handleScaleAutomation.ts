import { createHandler } from '#/utils/createHandler';

import { scaleAutomationValues } from '../../useCases/automation/scaleAutomationValues';

export const handleScaleAutomation = createHandler<'scaleAutomation'>({
    execute: (a) => {
        scaleAutomationValues(a.payload.laneId, a.payload.factor, a.payload.anchor);
    },
    describe: (a) => ({ label: `Scale automation ×${a.payload.factor}` }),
    undoable: true,
});
