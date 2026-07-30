import { type HandlerDescribeResult, type AutomationPointSnapshot } from '#/utils/handlerContract';

import { transformAutomationPoints } from '../../useCases/automation/transformAutomationPoints';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function clonePoint(point: AutomationPointSnapshot): AutomationPointSnapshot {
    return {
        ...point,
        ...(point.cp1 ? { cp1: { ...point.cp1 } } : {}),
        ...(point.cp2 ? { cp2: { ...point.cp2 } } : {}),
    };
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
