import { getAutomationLanes, removeAutomationLane, restoreAutomationLanes } from '#/modules/Automation/useCases';
import { type ClipAutomationLaneSnapshot } from '#/utils/handlerContract';

import { clipAutomationLaneTransitionMatchesStore } from './clipAutomationLaneTransitionMatchesStore';

/**
 * Move the clip-scoped automation lanes named by `expectedLanes` to the shape
 * named by `replacementLanes`. Both are full lane snapshots captured by
 * `readClipScopedAutomationLanes` — `expectedLanes` for what the automation
 * store holds now, `replacementLanes` for what it should hold after. A lane id
 * common to both sides survives untouched; one present only on the expected
 * side is retired; one present only on the replacement side is added back
 * (used for a migrated lane re-keyed to a new clip id).
 *
 * `affectedClipIds` is every clip id the owning operation touches (sources
 * plus target); `clipAutomationLaneTransitionMatchesStore` guards that the
 * live lanes for exactly that set equal `expectedLanes` and that no
 * replacement id collides with an unrelated live lane.
 *
 * Symmetric by construction: undo calls this again with the two lane
 * arguments swapped, which is exactly the inverse transition.
 *
 * Rejects (returns `false`) when that pre-flight fails, before writing
 * anything. It also returns `false` — after writing — when `restoreAutomation
 * Lanes` did not actually take: that call is void and silently drops the whole
 * batch when the automation store is null or any snapshot fails the store's
 * own exactness check, so the outcome is verified by re-reading the store
 * rather than assumed. Reporting success there would lose the very lane this
 * transition exists to carry.
 */
export function applyClipAutomationLaneTransition(
    affectedClipIds: readonly string[],
    expectedLanes: readonly ClipAutomationLaneSnapshot[],
    replacementLanes: readonly ClipAutomationLaneSnapshot[]
): boolean {
    if (!clipAutomationLaneTransitionMatchesStore(affectedClipIds, expectedLanes, replacementLanes)) {
        return false;
    }

    const expectedIds = new Set(expectedLanes.map((lane) => lane.id));
    const replacementIds = new Set(replacementLanes.map((lane) => lane.id));
    for (const lane of expectedLanes) {
        if (!replacementIds.has(lane.id)) {
            removeAutomationLane(lane.id);
        }
    }
    const lanesToRestore = replacementLanes.filter((lane) => !expectedIds.has(lane.id));
    if (lanesToRestore.length === 0) {
        return true;
    }
    restoreAutomationLanes(lanesToRestore);
    const liveLaneIds = new Set(getAutomationLanes().map((lane) => lane.id));
    return lanesToRestore.every((lane) => liveLaneIds.has(lane.id));
}
