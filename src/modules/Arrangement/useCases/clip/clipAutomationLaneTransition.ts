import { getAutomationLanes, removeAutomationLane, restoreAutomationLanes } from '#/modules/Automation/useCases';

export type AutomationLaneValue = ReturnType<typeof getAutomationLanes>[number];

/**
 * Full lane objects for every clip-scoped automation lane keyed to one of the
 * given clip ids. Track-level lanes (`clipId === undefined`) are never
 * included — this is only ever called with clip ids a clip-identity change is
 * about to retire or re-key.
 */
export function readClipScopedAutomationLanes(clipIds: readonly string[]): AutomationLaneValue[] {
    const idSet = new Set(clipIds);
    return getAutomationLanes().filter((lane) => lane.clipId !== undefined && idSet.has(lane.clipId));
}

function findLaneById(lanes: readonly AutomationLaneValue[], laneId: string): AutomationLaneValue | undefined {
    return lanes.find((lane) => lane.id === laneId);
}

function sortById(lanes: readonly AutomationLaneValue[]): AutomationLaneValue[] {
    return [...lanes].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Pure freshness check for `applyClipAutomationLaneTransition`'s guard,
 * exposed separately so a caller that must validate before it commits any
 * other store (e.g. one mutation earlier in the same transaction that cannot
 * be rolled back) can fail fast without writing anything.
 */
export function clipAutomationLaneTransitionMatchesStore(
    affectedClipIds: readonly string[],
    expectedLanes: readonly AutomationLaneValue[]
): boolean {
    const liveScopedLanes = readClipScopedAutomationLanes(affectedClipIds);
    return JSON.stringify(sortById(liveScopedLanes)) === JSON.stringify(sortById(expectedLanes));
}

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
 * plus target). The guard re-reads the CURRENT clip-scoped lanes for exactly
 * that set and requires it to equal `expectedLanes` — not just that every
 * named `expectedLanes` entry is present, but that nothing else lives there
 * either. Without the completeness half, a lane added out of band to one of
 * the affected ids after the snapshot was captured (e.g. directly onto a
 * freshly-glued clip) would go undetected and get orphaned the moment the
 * caller retires or re-keys that clip id.
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
        if (findLaneById(liveLanes, lane.id)) {
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
