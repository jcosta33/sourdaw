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
 * Atomic on the automation store: every `false` it returns leaves that store
 * exactly as it found it. Two things can fail, and they are ordered so the
 * fallible one runs first. `restoreAutomationLanes` is void and silently drops
 * the WHOLE batch when the automation store is null or any snapshot fails the
 * store's own exactness check, so its outcome is verified by re-reading the
 * store rather than assumed; reporting success there would lose the very lane
 * this transition exists to carry. Because that call is all-or-nothing, doing
 * it before the `removeAutomationLane` sweep means a failed restore has
 * written nothing and has nothing to roll back. Removing first and restoring
 * second would instead retire lanes and then refuse, destroying automation the
 * caller was told was untouched.
 *
 * The two id sets never overlap — `lanesToRestore` is exactly the replacement
 * ids absent from `expectedLanes`, and the pre-flight already proved none of
 * them collide with a live lane — so the intermediate state where both
 * coexist cannot lose or shadow either side.
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
    const lanesToRestore = replacementLanes.filter((lane) => !expectedIds.has(lane.id));
    if (lanesToRestore.length > 0) {
        restoreAutomationLanes(lanesToRestore);
        const liveLaneIds = new Set(getAutomationLanes().map((lane) => lane.id));
        if (!lanesToRestore.every((lane) => liveLaneIds.has(lane.id))) {
            return false;
        }
    }
    for (const lane of expectedLanes) {
        if (!replacementIds.has(lane.id)) {
            removeAutomationLane(lane.id);
        }
    }
    return true;
}
