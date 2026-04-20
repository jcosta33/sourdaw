import { getAutomationStoreState, removeAutomationPoint } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveAutomationPoint = createHandler<'removeAutomationPoint'>({
    execute: (a) => {
        const state = getAutomationStoreState();
        if (!state) {
            return;
        }
        const lane = state.lanes.find((l) => l.id === a.payload.laneId);
        if (!lane || a.payload.pointIndex < 0 || a.payload.pointIndex >= lane.points.length) {
            return;
        }
        const point = lane.points[a.payload.pointIndex];
        if (point) {
            removeAutomationPoint(a.payload.laneId, point.beat);
        }
    },
    describe: () => ({ label: 'Remove automation point' }),
    undoable: true,
});
