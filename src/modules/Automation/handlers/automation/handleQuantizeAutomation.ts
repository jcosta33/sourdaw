import { createHandler } from '#/utils/createHandler';

import { quantizeAutomationBeats } from '../../useCases/automation/quantizeAutomationBeats';

export const handleQuantizeAutomation = createHandler<'quantizeAutomation'>({
    execute: (alpha) => {
        quantizeAutomationBeats(alpha.payload.laneId, alpha.payload.gridSize);
    },
    describe: (alpha) => ({ label: `Quantize automation to ${alpha.payload.gridSize} beats` }),
    undoable: true,
});
