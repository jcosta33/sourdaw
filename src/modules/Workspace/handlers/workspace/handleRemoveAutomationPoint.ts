import { getAutomationStoreState, removeAutomationPoint } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveAutomationPoint = createHandler<'removeAutomationPoint'>({
    execute: (alpha) => {
        const state = getAutomationStoreState();
        if (!state) {
            return;
        }
        const lane = state.lanes.find((length) => length.id === alpha.payload.laneId);
        if (!lane || alpha.payload.pointIndex < 0 || alpha.payload.pointIndex >= lane.points.length) {
            return;
        }
        const point = lane.points[alpha.payload.pointIndex];
        if (point) {
            removeAutomationPoint(alpha.payload.laneId, point.beat);
        }
    },
    describe: () => ({ label: 'Remove automation point' }),
    undoable: true,
});
