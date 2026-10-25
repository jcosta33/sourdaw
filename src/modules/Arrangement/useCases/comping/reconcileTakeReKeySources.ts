import { canonicalJson } from '#/utils/canonicalDigest';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import {
    captureBaseGapAudioSources,
    reconcileBaseGapAudioSourceDelta,
    type OptionalAudioSourceTiles,
} from '../../stores/baseGapAudioSourceDelta';

import { regionsOverlap } from './regionsOverlap';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

function regionKey(region: CompRegion): string {
    return canonicalJson(region);
}

/**
 * Merge the additions into the kept live regions — both sorted by start — in
 * one linear walk: an addition that overlaps a kept region is refused. That is
 * the non-overlap law the store itself keeps, so a comp authored after the
 * capture is never displaced by the replay. Collision with the last merged
 * region needs no check: the while loop only passes kept regions ending at or
 * before the addition's start, and lawful additions — the plan validator
 * re-checks every side — are themselves sorted and non-overlapping.
 */
function mergeRegionsRefusingOverlaps(kept: readonly CompRegion[], additions: readonly CompRegion[]): CompRegion[] {
    const merged: CompRegion[] = [];
    let keptIndex = 0;
    for (const addition of additions) {
        while (keptIndex < kept.length && kept[keptIndex]!.endBeat <= addition.startBeat) {
            merged.push(kept[keptIndex]!);
            keptIndex++;
        }
        let collides = false;
        for (
            let scan = keptIndex;
            !collides && scan < kept.length && kept[scan]!.startBeat < addition.endBeat;
            scan++
        ) {
            if (regionsOverlap(kept[scan]!, addition)) {
                collides = true;
            }
        }
        if (!collides) {
            merged.push(addition);
        }
    }
    merged.push(...kept.slice(keptIndex));
    return merged;
}

/**
 * The comp-region facet of one lane, reconciled toward the target side.
 * Regions carry no id, so the deltas are by value: a region only the source
 * side holds leaves, a region only the target side holds comes back — unless
 * its take is gone or it overlaps a region already live, the same
 * non-overlap law the store itself keeps, so a comp authored after the
 * capture is never displaced by the replay.
 */
export function reconcileTransitionRegions(
    live: readonly CompRegion[],
    fromRegions: readonly CompRegion[],
    toRegions: readonly CompRegion[],
    takes: readonly Take[],
    removedTakeIds: ReadonlySet<string>
): readonly CompRegion[] {
    const fromKeys = new Set(fromRegions.map(regionKey));
    const toKeys = new Set(toRegions.map(regionKey));
    const liveTakeIds = new Set(takes.map((take) => take.id));

    const kept = live.filter(
        (region) =>
            !removedTakeIds.has(region.takeId) && (!fromKeys.has(regionKey(region)) || toKeys.has(regionKey(region)))
    );
    const additions = toRegions.filter(
        (region) =>
            !fromKeys.has(regionKey(region)) && region.endBeat > region.startBeat && liveTakeIds.has(region.takeId)
    );
    return mergeRegionsRefusingOverlaps(kept, additions);
}

export function reconcileTransitionBaseGaps(
    lane: TakeLane,
    transition: TakeReKeyLaneTransition,
    direction: 'apply' | 'restore'
): OptionalAudioSourceTiles | null {
    const from = direction === 'apply' ? transition.baseGapAudioSourcesBefore : transition.baseGapAudioSourcesAfter;
    const to = direction === 'apply' ? transition.baseGapAudioSourcesAfter : transition.baseGapAudioSourcesBefore;
    return reconcileBaseGapAudioSourceDelta(
        captureBaseGapAudioSources(lane),
        from === undefined ? { present: false } : { present: true, value: from },
        to === undefined ? { present: false } : { present: true, value: to }
    );
}

/** Authenticate every region value the writer replaces, including the source behind identical geometry. */
export function takeReKeySourceValuesMatch(
    lane: TakeLane | undefined,
    transition: TakeReKeyLaneTransition,
    direction: 'apply' | 'restore'
): boolean {
    const from = direction === 'apply' ? transition.regionsBefore : transition.regionsAfter;
    const to = direction === 'apply' ? transition.regionsAfter : transition.regionsBefore;
    const fromKeys = new Set(from.map(regionKey));
    const toKeys = new Set(to.map(regionKey));
    const removed = new Set(from.filter((region) => !toKeys.has(regionKey(region))).map(regionKey));
    const live = lane?.activeCompRegions ?? [];
    const liveTakeIds = new Set(lane?.takes.map((take) => take.id) ?? []);
    // A missing take may recover its captured region. A surviving take still
    // owns the exact physical source value, including an independent deletion.
    if (
        from.some(
            (region) =>
                removed.has(regionKey(region)) &&
                liveTakeIds.has(region.takeId) &&
                !live.some((candidate) => valuesEqual(candidate, region))
        )
    ) {
        return false;
    }
    const kept = live.filter((region) => !removed.has(regionKey(region)));
    if (
        to.some(
            (region) => !fromKeys.has(regionKey(region)) && kept.some((candidate) => regionsOverlap(candidate, region))
        )
    )
        return false;
    return (
        reconcileTransitionBaseGaps(
            lane ?? { id: transition.laneId, trackId: transition.trackId, takes: [], activeCompRegions: [] },
            transition,
            direction
        ) !== null
    );
}
