import { createHandler } from '#/utils/createHandler';

import { removeAutomationPoint } from '../../useCases/automation/removeAutomationPoint';
import { removeAutomationPointById } from '../../useCases/automation/removeAutomationPointById';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type RemoveAutomationPointPayload = {
    laneId: string;
    pointIndex: number;
    pointId?: string;
};

function getTargetPoint(payload: RemoveAutomationPointPayload) {
    const state = getAutomationStoreState();
    const lane = state?.lanes.find((candidate) => candidate.id === payload.laneId);
    if (!lane) {
        return undefined;
    }
    if (payload.pointId) {
        return lane.points.find((point) => point.id === payload.pointId);
    }
    if (payload.pointIndex < 0 || payload.pointIndex >= lane.points.length) {
        return undefined;
    }
    return lane.points[payload.pointIndex];
}
export const handleRemoveAutomationPoint = createHandler<'removeAutomationPoint'>({
    execute: (action) => {
        const point = getTargetPoint(action.payload);
        if (!point) {
            return;
        }
        if (action.payload.pointId) {
            removeAutomationPointById(action.payload.laneId, action.payload.pointId);
            return;
        }
        removeAutomationPoint(action.payload.laneId, point.beat);
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
        const point = getTargetPoint(action.payload);
        if (!lane || !point) {
            return { label: 'Remove automation point' };
        }
        const beatDuplicated = lane.points.filter((candidate) => candidate.beat === point.beat).length > 1;
        if (!action.payload.pointId && beatDuplicated) {
            return { label: 'Remove automation point' };
        }
        if (lane.linkedLaneId) {
            const pointIndex = lane.points.indexOf(point);
            const equalBeatIndex = lane.points
                .slice(0, pointIndex)
                .filter((candidate) => candidate.beat === point.beat).length;
            const expectedEqualBeatPoints = lane.points.filter(
                (candidate) => candidate !== point && candidate.beat === point.beat
            );
            const owner: { trackId: string; parameterId: string; linkedLaneId: string; clipId?: string } = {
                trackId: lane.trackId,
                parameterId: lane.parameterId,
                linkedLaneId: lane.linkedLaneId,
            };
            if (lane.clipId !== undefined) {
                owner.clipId = lane.clipId;
            }
            return {
                label: 'Remove automation point',
                inverseAction: {
                    type: 'restoreAutomationPointPresence',
                    payload: {
                        laneId: action.payload.laneId,
                        owner,
                        point,
                        equalBeatIndex,
                        expectedEqualBeatPoints,
                        expectedPresence: 'absent',
                        replacementPresence: 'present',
                    },
                },
                redoAction: {
                    type: 'restoreAutomationPointPresence',
                    payload: {
                        laneId: action.payload.laneId,
                        owner,
                        point,
                        equalBeatIndex,
                        expectedEqualBeatPoints,
                        expectedPresence: 'present',
                        replacementPresence: 'absent',
                    },
                },
            };
        }
        return {
            label: 'Remove automation point',
            inverseAction: {
                type: 'addAutomationPoint',
                payload: {
                    laneId: action.payload.laneId,
                    pointId: point.id,
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
