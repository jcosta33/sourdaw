import { createHandler } from '#/helpers/createHandler';
import { quantizeAutomationBeats } from '../../useCases/automation/quantizeAutomationBeats';

export const handleQuantizeAutomation = createHandler<'quantizeAutomation'>({
    execute: (a) => {
        quantizeAutomationBeats(a.payload.laneId, a.payload.gridSize);
    },
    describe: (a) => ({ label: `Quantize automation to ${a.payload.gridSize} beats` }),
    undoable: true,
});
