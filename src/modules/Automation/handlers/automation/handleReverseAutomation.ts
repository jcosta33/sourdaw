import { createHandler } from '#/utils/createHandler';

import { reverseAutomation } from '../../useCases/automation/reverseAutomation';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleReverseAutomation = createHandler<'reverseAutomation'>({
    execute: (alpha) => {
        reverseAutomation(alpha.payload.laneId);
    },
    isNoop: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        return !lane || lane.points.length <= 1;
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) => describeLaneTransformUndo(alpha.payload.laneId, 'Reverse automation', { type: 'reverse' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
