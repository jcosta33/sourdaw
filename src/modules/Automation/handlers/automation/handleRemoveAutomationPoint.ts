import { createHandler } from '#/utils/createHandler';

import { removeAutomationPoint } from '../../useCases/automation/removeAutomationPoint';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

export const handleRemoveAutomationPoint = createHandler<'removeAutomationPoint'>({
    execute: (action) => {
        const state = getAutomationStoreState();
        if (!state) {
            return;
        }
        const lane = state.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (!lane || action.payload.pointIndex < 0 || action.payload.pointIndex >= lane.points.length) {
            return;
        }
        const point = lane.points[action.payload.pointIndex];
        if (point) {
            removeAutomationPoint(action.payload.laneId, point.beat);
        }
    },
    describe: () => ({ label: 'Remove automation point' }),
    undoable: true,
});
