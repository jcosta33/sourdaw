import { type AutomationPointSnapshot } from '#/utils/handlerContract';

import { type AutomationPoint } from '../../models/Automation';

function controlPointsMatch(
    current: { x: number; y: number } | undefined,
    expected: { readonly x: number; readonly y: number } | undefined
): boolean {
    return current?.x === expected?.x && current?.y === expected?.y;
}

/**
 * `expected` is document data carried by an inverse action (possibly a remote
 * peer's), so an entry can be null or a non-object at runtime even though the
 * contract types it as a snapshot. Such an entry cannot be compared
 * field-by-field and therefore cannot match.
 */
function isComparableSnapshot(value: unknown): value is AutomationPointSnapshot {
    return value !== null && typeof value === 'object';
}

/** Whether a lane holds exactly the expected points, field by field and in order. */
export function automationPointSnapshotsMatch(
    current: readonly AutomationPoint[],
    expected: readonly AutomationPointSnapshot[]
): boolean {
    return (
        Array.isArray(expected) &&
        current.length === expected.length &&
        current.every((point, index) => {
            const expectedPoint: unknown = expected[index];
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
