import { createHandler } from '#/utils/createHandler';

import { stretchAutomationTime } from '../../useCases/automation/stretchAutomationTime';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { describeLaneTransformUndo } from './automationTransformUndo';
import { findFollowerLaneRefusal } from './followerLaneRefusal';

export const handleStretchAutomation = createHandler<'stretchAutomation'>({
    execute: (alpha) => {
        const followerRefusal = findFollowerLaneRefusal(alpha.payload.laneId);
        if (followerRefusal) {
            return { status: 'conflict', reason: followerRefusal };
        }
        stretchAutomationTime(alpha.payload.laneId, alpha.payload.factor, alpha.payload.anchorBeat);
        return undefined;
    },
    isNoop: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        return !lane || lane.points.length === 0 || action.payload.factor === 1;
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) =>
        describeLaneTransformUndo(alpha.payload.laneId, `Stretch automation ×${alpha.payload.factor}`, {
            type: 'stretch',
            factor: alpha.payload.factor,
            anchorBeat: alpha.payload.anchorBeat,
        }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
