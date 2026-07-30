import { createHandler } from '#/utils/createHandler';

import { addAutomationPoint } from '../../useCases/automation/addAutomationPoint';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function ensurePointId(action: { payload: { pointId?: string } }): string {
    if (action.payload.pointId) {
        return action.payload.pointId;
    }
    const pointId = `auto-point-${crypto.randomUUID()}`;
    action.payload.pointId = pointId;
    return pointId;
}

export const handleAddAutomationPoint = createHandler<'addAutomationPoint'>({
    execute: (action) => {
        addAutomationPoint(action.payload.laneId, {
            id: ensurePointId(action),
            beat: action.payload.beat,
            value: action.payload.value,
            curve: action.payload.curve ?? 'linear',
            tension: action.payload.tension ?? 0,
            stairSteps: action.payload.stairSteps,
            cp1: action.payload.cp1,
            cp2: action.payload.cp2,
        });
    },
    describe: (action) => {
        const state = getAutomationStoreState();
        const lane = state?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (!lane) {
            return { label: 'Add automation point' };
        }
        const pointId = ensurePointId(action);
        const insertedIndex = lane.points.filter((point) => point.beat < action.payload.beat).length;
        return {
            label: 'Add automation point',
            inverseAction: {
                type: 'removeAutomationPoint',
                payload: { laneId: action.payload.laneId, pointIndex: insertedIndex, pointId },
            },
        };
    },
    undoable: true,
});
