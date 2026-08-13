import { createHandler } from '#/utils/createHandler';

import { thinAutomationPoints } from '../../useCases/automation/thinAutomationPoints';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleThinAutomation = createHandler<'thinAutomation'>({
    execute: (alpha) => {
        thinAutomationPoints(alpha.payload.laneId, alpha.payload.tolerance);
    },
    isNoop: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        return !lane || lane.points.length <= 2;
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) =>
        describeLaneTransformUndo(alpha.payload.laneId, 'Thin automation points', {
            type: 'thin',
            tolerance: alpha.payload.tolerance,
        }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
