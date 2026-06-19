import { createHandler } from '#/utils/createHandler';

import { invertAutomation } from '../../useCases/automation/invertAutomation';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleInvertAutomation = createHandler<'invertAutomation'>({
    execute: (alpha) => {
        invertAutomation(alpha.payload.laneId);
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) => describeLaneTransformUndo(alpha.payload.laneId, 'Invert automation'),
    undoable: true,
});
