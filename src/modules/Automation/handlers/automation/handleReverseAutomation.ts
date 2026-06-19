import { createHandler } from '#/utils/createHandler';

import { reverseAutomation } from '../../useCases/automation/reverseAutomation';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleReverseAutomation = createHandler<'reverseAutomation'>({
    execute: (alpha) => {
        reverseAutomation(alpha.payload.laneId);
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) => describeLaneTransformUndo(alpha.payload.laneId, 'Reverse automation'),
    undoable: true,
});
