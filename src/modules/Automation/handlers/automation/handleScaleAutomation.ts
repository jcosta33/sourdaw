import { createHandler } from '#/utils/createHandler';

import { scaleAutomationValues } from '../../useCases/automation/scaleAutomationValues';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleScaleAutomation = createHandler<'scaleAutomation'>({
    execute: (alpha) => {
        scaleAutomationValues(alpha.payload.laneId, alpha.payload.factor, alpha.payload.anchor);
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) => describeLaneTransformUndo(alpha.payload.laneId, `Scale automation ×${alpha.payload.factor}`),
    undoable: true,
});
