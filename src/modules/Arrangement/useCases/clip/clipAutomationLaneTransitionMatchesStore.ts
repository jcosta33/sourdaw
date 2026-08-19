import { type AutomationLaneValue, readClipScopedAutomationLanes } from './readClipScopedAutomationLanes';

function sortById(lanes: readonly AutomationLaneValue[]): AutomationLaneValue[] {
    return [...lanes].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Pure freshness check for `applyClipAutomationLaneTransition`'s guard,
 * exposed separately so a caller that must validate before it commits any
 * other store (e.g. one mutation earlier in the same transaction that cannot
 * be rolled back) can fail fast without writing anything.
 *
 * The check is complete, not just sufficient: it re-reads the CURRENT
 * clip-scoped lanes for exactly `affectedClipIds` and requires that set to
 * equal `expectedLanes` — not just that every named `expectedLanes` entry is
 * present, but that nothing else lives there either. Without the completeness
 * half, a lane added out of band to one of the affected ids after the
 * snapshot was captured (e.g. directly onto a freshly-glued clip) would go
 * undetected and get orphaned the moment the caller retires or re-keys that
 * clip id.
 */
export function clipAutomationLaneTransitionMatchesStore(
    affectedClipIds: readonly string[],
    expectedLanes: readonly AutomationLaneValue[]
): boolean {
    const liveScopedLanes = readClipScopedAutomationLanes(affectedClipIds);
    return JSON.stringify(sortById(liveScopedLanes)) === JSON.stringify(sortById(expectedLanes));
}
