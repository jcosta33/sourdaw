import { createHandler } from '#/utils/createHandler';

import { invertAutomation } from '../../useCases/automation/invertAutomation';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { describeLaneTransformUndo } from './automationTransformUndo';
import { findFollowerLaneRefusal } from './followerLaneRefusal';

export const handleInvertAutomation = createHandler<'invertAutomation'>({
    execute: (alpha) => {
        const followerRefusal = findFollowerLaneRefusal(alpha.payload.laneId);
        if (followerRefusal) {
            return { status: 'conflict', reason: followerRefusal };
        }
        invertAutomation(alpha.payload.laneId);
        return undefined;
    },
    isNoop: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        return !lane || lane.points.length === 0;
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) => describeLaneTransformUndo(alpha.payload.laneId, 'Invert automation', { type: 'invert' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
