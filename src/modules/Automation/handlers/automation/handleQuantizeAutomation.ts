import { createHandler } from '#/utils/createHandler';

import { quantizeAutomationBeats } from '../../useCases/automation/quantizeAutomationBeats';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleQuantizeAutomation = createHandler<'quantizeAutomation'>({
    execute: (alpha) => {
        quantizeAutomationBeats(alpha.payload.laneId, alpha.payload.gridSize);
    },
    isNoop: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        return !lane || lane.points.length === 0;
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) =>
        describeLaneTransformUndo(alpha.payload.laneId, `Quantize automation to ${alpha.payload.gridSize} beats`, {
            type: 'quantize',
            gridSize: alpha.payload.gridSize,
        }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
