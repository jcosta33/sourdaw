import { createHandler } from '#/utils/createHandler';

import { addAutomationPoint } from '../../useCases/automation/addAutomationPoint';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

export const handleAddAutomationPoint = createHandler<'addAutomationPoint'>({
    execute: (action) => {
        addAutomationPoint(action.payload.laneId, {
            beat: action.payload.beat,
            value: action.payload.value,
            curve: action.payload.curve ?? 'linear',
            tension: action.payload.tension ?? 0,
            stairSteps: action.payload.stairSteps,
            cp1: action.payload.cp1,
            cp2: action.payload.cp2,
        });
    },
    // Runs PRE-execute (see executeAppAction). The inverse of adding a point is
    // removing it. `removeAutomationPoint` deletes by beat, so it is only a faithful
    // inverse when no point already occupies this beat — otherwise it would also
    // delete the pre-existing point. When a collision exists we cannot express a
    // lossless inverse with the available actions, so we omit it rather than emit a
    // lossy one (which would silently drop the colliding point on undo).
    describe: (action) => {
        const state = getAutomationStoreState();
        const lane = state?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (!lane) {
            return { label: 'Add automation point' };
        }
        const beatCollision = lane.points.some((point) => point.beat === action.payload.beat);
        if (beatCollision) {
            return { label: 'Add automation point' };
        }
        // After the point is inserted and the lane re-sorted by beat, the new point's
        // index equals the count of existing points whose beat is strictly less.
        const insertedIndex = lane.points.filter((point) => point.beat < action.payload.beat).length;
        return {
            label: 'Add automation point',
            inverseAction: {
                type: 'removeAutomationPoint',
                payload: { laneId: action.payload.laneId, pointIndex: insertedIndex },
            },
        };
    },
    undoable: true,
});
