import { type AutomationPointSnapshot, type ClipAutomationLaneActionSnapshot } from '#/utils/handlerContract';

import { type AutomationPoint, type AutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

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

/**
 * Same expected-lane match `restoreClipAutomationMoveState` writes against.
 * `projectedLanes` replaces the live store for a batch-aware preflight (#3814):
 * a prior sibling's restore has not executed yet, so the member validates
 * against the lanes that sibling re-establishes. Execution omits it and reads
 * live.
 */
export function clipAutomationMoveStateMatches(
    clipId: string,
    expected: readonly ClipAutomationLaneActionSnapshot[],
    projectedLanes?: readonly AutomationLane[]
): boolean {
    const laneSource = projectedLanes ?? automationStore.value?.lanes ?? [];
    const current = laneSource
        .filter((lane) => lane.clipId === clipId)
        .sort((left, right) => left.id.localeCompare(right.id));
    const sortedExpected = [...expected].sort((left, right) => left.id.localeCompare(right.id));
    return (
        current.length === sortedExpected.length &&
        current.every((lane, index) => {
            const expectedLane = sortedExpected[index];
            return (
                expectedLane !== undefined &&
                lane.id === expectedLane.id &&
                lane.trackId === expectedLane.trackId &&
                pointsMatch(lane.points, expectedLane.points)
            );
        })
    );
}
