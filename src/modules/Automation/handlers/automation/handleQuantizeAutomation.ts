import { createHandler } from '#/utils/createHandler';

import { quantizeAutomationBeats } from '../../useCases/automation/quantizeAutomationBeats';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleQuantizeAutomation = createHandler<'quantizeAutomation'>({
    execute: (alpha) => {
        quantizeAutomationBeats(alpha.payload.laneId, alpha.payload.gridSize);
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) =>
        describeLaneTransformUndo(alpha.payload.laneId, `Quantize automation to ${alpha.payload.gridSize} beats`),
    undoable: true,
});
