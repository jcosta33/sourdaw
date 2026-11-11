import { type HandlerDescribeResult } from '#/utils/handlerContract';

import { type AutomationPoint } from '../../models/Automation';
import { transformAutomationPoints } from '../../useCases/automation/transformAutomationPoints';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function clonePoint(point: AutomationPoint): AutomationPoint {
    const clone: AutomationPoint = {
        beat: point.beat,
        value: point.value,
        curve: point.curve,
        tension: point.tension,
    };
    if (point.id !== undefined) {
        clone.id = point.id;
    }
    if (point.stairSteps !== undefined) {
        clone.stairSteps = point.stairSteps;
    }
    if (point.cp1 !== undefined) {
        clone.cp1 = { x: point.cp1.x, y: point.cp1.y };
    }
    if (point.cp2 !== undefined) {
        clone.cp2 = { x: point.cp2.x, y: point.cp2.y };
    }
    return clone;
}

/** Capture both sides of a lane transform so an old inverse can reject stale state. */
export function describeLaneTransformUndo(
    laneId: string,
    label: string,
    transform: Parameters<typeof transformAutomationPoints>[1]
): HandlerDescribeResult {
    const state = getAutomationStoreState();
    const lane = state?.lanes.find((candidate) => candidate.id === laneId);
    if (!lane) {
        return { label };
    }
    const points = lane.points.map(clonePoint);
    const expectedPoints = transformAutomationPoints(lane, transform).map(clonePoint);
    return {
        label,
        inverseAction: {
            type: 'restoreAutomationLanePoints',
            payload: { laneId, points, expectedPoints },
        },
    };
}
