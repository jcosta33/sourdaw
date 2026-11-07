import { canonicalJson } from '#/utils/canonicalDigest';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type TakeLane } from '../../models/TakeLane';

import { reconcileTransitionBaseGaps } from './reconcileTakeReKeySources';
import { regionsOverlap } from './regionsOverlap';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

function regionKey(region: CompRegion): string {
    return canonicalJson(region);
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
    ) {
        return false;
    }
    return (
        reconcileTransitionBaseGaps(
            lane ?? { id: transition.laneId, trackId: transition.trackId, takes: [], activeCompRegions: [] },
            transition,
            direction
        ) !== null
    );
}
