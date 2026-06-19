import { createHandler } from '#/utils/createHandler';

import { stretchAutomationTime } from '../../useCases/automation/stretchAutomationTime';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleStretchAutomation = createHandler<'stretchAutomation'>({
    execute: (alpha) => {
        stretchAutomationTime(alpha.payload.laneId, alpha.payload.factor, alpha.payload.anchorBeat);
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) => describeLaneTransformUndo(alpha.payload.laneId, `Stretch automation ×${alpha.payload.factor}`),
    undoable: true,
});
