import { createHandler } from '#/utils/createHandler';

import { thinAutomationPoints } from '../../useCases/automation/thinAutomationPoints';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleThinAutomation = createHandler<'thinAutomation'>({
    execute: (alpha) => {
        thinAutomationPoints(alpha.payload.laneId, alpha.payload.tolerance);
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) => describeLaneTransformUndo(alpha.payload.laneId, 'Thin automation points'),
    undoable: true,
});
