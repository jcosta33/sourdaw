import { createHandler } from '#/utils/createHandler';
import { type AutomationPointSnapshot } from '#/utils/handlerContract';

import { type AutomationPoint } from '../../models/Automation';
import { restoreAutomationLanePoints } from '../../useCases/automation/restoreAutomationLanePoints';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function controlPointsMatch(
    current: { x: number; y: number } | undefined,
    expected: { readonly x: number; readonly y: number } | undefined
): boolean {
    return current?.x === expected?.x && current?.y === expected?.y;
}

function pointsMatch(current: readonly AutomationPoint[], expected: readonly AutomationPointSnapshot[]): boolean {
    return (
        current.length === expected.length &&
        current.every((point, index) => {
            const expectedPoint = expected[index];
            return (
                expectedPoint !== undefined &&
                point.id === expectedPoint.id &&
                point.beat === expectedPoint.beat &&
                point.value === expectedPoint.value &&
                point.curve === expectedPoint.curve &&
                point.tension === expectedPoint.tension &&
                point.stairSteps === expectedPoint.stairSteps &&
                controlPointsMatch(point.cp1, expectedPoint.cp1) &&
                controlPointsMatch(point.cp2, expectedPoint.cp2)
            );
        })
    );
}

export const handleRestoreAutomationLanePoints = createHandler<'restoreAutomationLanePoints'>({
    execute: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (action.payload.expectedPoints && (!lane || !pointsMatch(lane.points, action.payload.expectedPoints))) {
            return { status: 'conflict' };
        }
        if (!lane) {
            return { status: 'no-write' };
        }
        restoreAutomationLanePoints(action.payload.laneId, action.payload.points as AutomationPoint[]);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (action.payload.expectedPoints && (!lane || !pointsMatch(lane.points, action.payload.expectedPoints))) {
            return false;
        }
        return !lane || pointsMatch(lane.points, action.payload.points);
    },
    describe: () => ({ label: 'Restore automation points' }),
    undoable: false,
});
