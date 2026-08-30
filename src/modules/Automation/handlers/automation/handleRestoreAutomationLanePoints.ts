import { createHandler } from '#/utils/createHandler';
import { type AutomationPointSnapshot } from '#/utils/handlerContract';

import { type AutomationPoint } from '../../models/Automation';
import { is_exact_automation_point, is_sorted_by_beat } from '../../stores/automationStore';
import { restoreAutomationLanePoints } from '../../useCases/automation/restoreAutomationLanePoints';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function controlPointsMatch(
    current: { x: number; y: number } | undefined,
    expected: { readonly x: number; readonly y: number } | undefined
): boolean {
    return current?.x === expected?.x && current?.y === expected?.y;
}

/**
 * `expectedPoints` is document data carried by the inverse action (possibly a
 * remote peer's), so an entry can be null or a non-object at runtime even
 * though the contract types it as a snapshot. Such an entry cannot be compared
 * field-by-field and therefore cannot match — `pointsMatch` returning false
 * refuses the restore as a conflict, the same outcome as a divergence.
 */
function isComparableSnapshot(value: unknown): value is AutomationPointSnapshot {
    return value !== null && typeof value === 'object';
}

function pointsMatch(current: readonly AutomationPoint[], expected: readonly AutomationPointSnapshot[]): boolean {
    return (
        current.length === expected.length &&
        current.every((point, index) => {
            const expectedPoint = expected[index];
            return (
                isComparableSnapshot(expectedPoint) &&
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

/**
 * Every replacement point carries exactly the store's point shape, checked per
 * point the way `restoreAutomationLanes` checks whole lanes — including the
 * ascending-by-beat order `is_exact_automation_lane` requires via
 * `is_sorted_by_beat`. This action arrives from undo/redo of a possibly remote
 * peer's document, so the payload is document data rather than in-memory
 * state: a malformed or out-of-order point set must refuse the restore
 * (conflict-style, like an `expectedPoints` divergence) rather than write
 * garbage into the lane.
 */
function isRestorablePointSet(points: readonly AutomationPointSnapshot[]): points is AutomationPoint[] {
    if (!Array.isArray(points)) {
        return false;
    }
    for (let index = 0; index < points.length; index += 1) {
        if (!Object.hasOwn(points, index) || !is_exact_automation_point(points[index])) {
            return false;
        }
    }
    return is_sorted_by_beat(points);
}

export const handleRestoreAutomationLanePoints = createHandler<'restoreAutomationLanePoints'>({
    execute: (action) => {
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (!isRestorablePointSet(action.payload.points)) {
            return { status: 'conflict' };
        }
        if (action.payload.expectedPoints && (!lane || !pointsMatch(lane.points, action.payload.expectedPoints))) {
            return { status: 'conflict' };
        }
        if (!lane) {
            return { status: 'no-write' };
        }
        restoreAutomationLanePoints(action.payload.laneId, action.payload.points);
        return { status: 'written' };
    },
    isNoop: (action) => {
        if (!isRestorablePointSet(action.payload.points)) {
            return false;
        }
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === action.payload.laneId);
        if (action.payload.expectedPoints && (!lane || !pointsMatch(lane.points, action.payload.expectedPoints))) {
            return false;
        }
        return !lane || pointsMatch(lane.points, action.payload.points);
    },
    describe: () => ({ label: 'Restore automation points' }),
    undoable: false,
});
