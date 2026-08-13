import { createHandler } from '#/utils/createHandler';

import { scaleAutomationValues } from '../../useCases/automation/scaleAutomationValues';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import { describeLaneTransformUndo } from './automationTransformUndo';

export const handleScaleAutomation = createHandler<'scaleAutomation'>({
    execute: (alpha) => {
        scaleAutomationValues(alpha.payload.laneId, alpha.payload.factor, alpha.payload.anchor);
    },
    isNoop: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        return !lane || lane.points.length === 0 || action.payload.factor === 1;
    },
    // Pre-execute snapshot of the lane's points; undo restores them. See
    // describeLaneTransformUndo.
    describe: (alpha) =>
        describeLaneTransformUndo(alpha.payload.laneId, `Scale automation ×${alpha.payload.factor}`, {
            type: 'scale',
            factor: alpha.payload.factor,
            anchor: alpha.payload.anchor,
        }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
