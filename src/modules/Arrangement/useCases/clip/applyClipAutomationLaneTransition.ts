import { getAutomationLanes, removeAutomationLane, restoreAutomationLanes } from '#/modules/Automation/useCases';

import { clipAutomationLaneTransitionMatchesStore } from './clipAutomationLaneTransitionMatchesStore';

import type { AutomationLaneValue } from './readClipScopedAutomationLanes';

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
 * live lanes for exactly that set equal `expectedLanes`.
 *
 * Symmetric by construction: undo calls this again with the two lane
 * arguments swapped, which is exactly the inverse transition.
 *
 * Rejects (returns `false`, writes nothing) when the live lanes for
 * `affectedClipIds` do not exactly match `expectedLanes`, or when a lane only
 * `replacementLanes` names would collide with an unrelated lane already
 * living at that id.
 */
export function applyClipAutomationLaneTransition(
    affectedClipIds: readonly string[],
    expectedLanes: readonly AutomationLaneValue[],
    replacementLanes: readonly AutomationLaneValue[]
): boolean {
    if (!clipAutomationLaneTransitionMatchesStore(affectedClipIds, expectedLanes)) {
        return false;
    }

    const expectedIds = new Set(expectedLanes.map((lane) => lane.id));
    const liveLanes = getAutomationLanes();
    for (const lane of replacementLanes) {
        if (expectedIds.has(lane.id)) {
            continue;
        }
        if (liveLanes.some((liveLane) => liveLane.id === lane.id)) {
            return false;
        }
    }

    const replacementIds = new Set(replacementLanes.map((lane) => lane.id));
    for (const lane of expectedLanes) {
        if (!replacementIds.has(lane.id)) {
            removeAutomationLane(lane.id);
        }
    }
    const lanesToRestore = replacementLanes.filter((lane) => !expectedIds.has(lane.id));
    if (lanesToRestore.length > 0) {
        restoreAutomationLanes(lanesToRestore);
    }
    return true;
}
