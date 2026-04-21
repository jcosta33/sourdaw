import { createHandler } from '#/utils/createHandler';

import { scaleAutomationValues } from '../../useCases/automation/scaleAutomationValues';

export const handleScaleAutomation = createHandler<'scaleAutomation'>({
    execute: (alpha) => {
        scaleAutomationValues(alpha.payload.laneId, alpha.payload.factor, alpha.payload.anchor);
    },
    describe: (alpha) => ({ label: `Scale automation ×${alpha.payload.factor}` }),
    undoable: true,
});
