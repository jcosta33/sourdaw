import {
    addAutomationLane,
    batchAddAutomationPoints,
    getAutomationLanes,
    removeAutomationPoint,
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

function resolveLaneId(input: CommitInlineAutomationPaintInput): string | null {
    if (input.laneId) {
        return input.laneId;
    }

    const existingLane = getAutomationLanes().find(
        (lane) => lane.trackId === input.trackId && lane.parameterId === input.parameterId
    );
    if (existingLane) {
        return existingLane.id;
    }

    addAutomationLane(input.trackId, input.parameterId, input.parameterName);
    const createdLane = getAutomationLanes().find(
        (lane) => lane.trackId === input.trackId && lane.parameterId === input.parameterId
    );

    return createdLane?.id ?? null;
}

export function commitInlineAutomationPaint(input: CommitInlineAutomationPaintInput): boolean {
    if (input.points.length === 0) {
        return false;
    }

    const laneId = resolveLaneId(input);
    if (!laneId) {
        return false;
    }

    const points = input.points.map((point) => ({ ...point }));
    batchAddAutomationPoints(laneId, points);
    pushUndoEntry(
        `Draw ${points.length} automation point${points.length > 1 ? 's' : ''}`,
        () => {
            for (const point of points) {
                removeAutomationPoint(laneId, point.beat);
            }
        },
        () => {
            batchAddAutomationPoints(laneId, points);
        }
    );

    return true;
}
