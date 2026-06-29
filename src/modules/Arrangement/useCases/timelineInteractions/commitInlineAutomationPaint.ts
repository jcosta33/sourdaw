import {
    addAutomationLane,
    batchAddAutomationPoints,
    getAutomationLanes,
    removeAutomationLane,
    replaceAutomationLanePoints,
} from '#/modules/Automation/useCases';
import { pushUndoEntry } from '#/modules/Command/stores';

import { type AutomationPoint } from '../../models/AutomationViewTypes';

type CommitInlineAutomationPaintInput = {
    laneId?: string;
    trackId: string;
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
};

type AutomationLaneForPaint = ReturnType<typeof getAutomationLanes>[number];

type AutomationLaneSnapshot = {
    id: string;
    trackId: string;
    parameterId: string;
    parameterName: string;
    points: AutomationPoint[];
};

function clonePoints(points: AutomationPoint[]): AutomationPoint[] {
    return points.map((point) => ({ ...point }));
}

function cloneLane(lane: AutomationLaneForPaint): AutomationLaneSnapshot {
    return {
        id: lane.id,
        trackId: lane.trackId,
        parameterId: lane.parameterId,
        parameterName: lane.parameterName,
        points: clonePoints(lane.points),
    };
}

function findTargetLane(input: CommitInlineAutomationPaintInput): AutomationLaneForPaint | null {
    const lanes = getAutomationLanes();
    if (input.laneId) {
        return lanes.find((lane) => lane.id === input.laneId) ?? null;
    }

    return lanes.find((lane) => lane.trackId === input.trackId && lane.parameterId === input.parameterId) ?? null;
}

function createTargetLane(input: CommitInlineAutomationPaintInput): AutomationLaneForPaint | null {
    addAutomationLane(input.trackId, input.parameterId, input.parameterName);
    return findTargetLane(input);
}

export function commitInlineAutomationPaint(input: CommitInlineAutomationPaintInput): boolean {
    if (input.points.length === 0) {
        return false;
    }

    const previousLane = findTargetLane(input);
    if (!previousLane && input.laneId) {
        return false;
    }

    const targetLane = previousLane ?? createTargetLane(input);
    if (!targetLane) {
        return false;
    }

    const points = input.points.map((point) => ({ ...point }));
    const previousSnapshot = previousLane ? cloneLane(previousLane) : null;
    let activeLaneId = targetLane.id;

    batchAddAutomationPoints(activeLaneId, points);

    const nextLane = getAutomationLanes().find((lane) => lane.id === activeLaneId);
    const nextPoints = nextLane ? clonePoints(nextLane.points) : points;

    pushUndoEntry(
        `Draw ${points.length} automation point${points.length > 1 ? 's' : ''}`,
        () => {
            if (previousSnapshot) {
                replaceAutomationLanePoints({ laneId: previousSnapshot.id, points: previousSnapshot.points });
                return;
            }
            removeAutomationLane(activeLaneId);
        },
        () => {
            if (previousSnapshot) {
                replaceAutomationLanePoints({ laneId: previousSnapshot.id, points: nextPoints });
                return;
            }

            const redoneLane = createTargetLane(input);
            if (!redoneLane) {
                return;
            }
            activeLaneId = redoneLane.id;
            replaceAutomationLanePoints({ laneId: activeLaneId, points: nextPoints });
        }
    );

    return true;
}
