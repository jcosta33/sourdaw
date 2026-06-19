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
    // Runs PRE-execute (see executeAppAction). The inverse of removing a point is
    // re-adding it. `removeAutomationPoint` deletes every point at the target beat,
    // so re-adding a single point is only a faithful inverse when that beat is unique
    // in the lane — otherwise sibling points at the same beat would be lost on undo
    // and could not be restored. When duplicates exist we omit the inverse rather than
    // emit a lossy one.
    describe: (action) => {
        const state = getAutomationStoreState();
        const lane = state?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (!lane || action.payload.pointIndex < 0 || action.payload.pointIndex >= lane.points.length) {
            return { label: 'Remove automation point' };
        }
        const point = lane.points[action.payload.pointIndex];
        if (!point) {
            return { label: 'Remove automation point' };
        }
        const beatDuplicated = lane.points.filter((candidate) => candidate.beat === point.beat).length > 1;
        if (beatDuplicated) {
            return { label: 'Remove automation point' };
        }
        return {
            label: 'Remove automation point',
            inverseAction: {
                type: 'addAutomationPoint',
                payload: {
                    laneId: action.payload.laneId,
                    beat: point.beat,
                    value: point.value,
                    curve: point.curve,
                    tension: point.tension,
                    stairSteps: point.stairSteps,
                    cp1: point.cp1,
                    cp2: point.cp2,
                },
            },
        };
    },
    undoable: true,
});
