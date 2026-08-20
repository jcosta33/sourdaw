import { getAutomationLanes } from '#/modules/Automation/useCases';
import { type ClipAutomationLaneSnapshot } from '#/utils/handlerContract';

import { readClipScopedAutomationLanes } from './readClipScopedAutomationLanes';

function sortById(lanes: readonly ClipAutomationLaneSnapshot[]): ClipAutomationLaneSnapshot[] {
    return [...lanes].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Pure freshness check for `applyClipAutomationLaneTransition`'s guard,
 * exposed separately so a caller that must validate before it commits any
 * other store (e.g. one mutation earlier in the same transaction that cannot
 * be rolled back) can fail fast without writing anything.
 *
 * The check is complete, not just sufficient, on both halves of the
 * transition:
 *
 * - It re-reads the CURRENT clip-scoped lanes for exactly `affectedClipIds`
 *   and requires that set to equal `expectedLanes` — not just that every
 *   named `expectedLanes` entry is present, but that nothing else lives
 *   there either. Without this half, a lane added out of band to one of the
 *   affected ids after the snapshot was captured (e.g. directly onto a
 *   freshly-glued clip) would go undetected and get orphaned the moment the
 *   caller retires or re-keys that clip id.
 * - It rejects a `replacementLanes` entry that would be added back onto an id
 *   already occupied by an unrelated live lane. That collision is the only
 *   other way `applyClipAutomationLaneTransition` can refuse, so hoisting it
 *   here is what makes "validate every store before mutating any of them"
 *   true for the callers: without it the apply step could bail after an
 *   earlier, unrollbackable store write had already landed.
 */
export function clipAutomationLaneTransitionMatchesStore(
    affectedClipIds: readonly string[],
    expectedLanes: readonly ClipAutomationLaneSnapshot[],
    replacementLanes: readonly ClipAutomationLaneSnapshot[]
): boolean {
    const liveScopedLanes = readClipScopedAutomationLanes(affectedClipIds);
    if (JSON.stringify(sortById(liveScopedLanes)) !== JSON.stringify(sortById(expectedLanes))) {
        return false;
    }

    const expectedIds = new Set(expectedLanes.map((lane) => lane.id));
    const liveLaneIds = new Set(getAutomationLanes().map((lane) => lane.id));
    return !replacementLanes.some((lane) => !expectedIds.has(lane.id) && liveLaneIds.has(lane.id));
}
