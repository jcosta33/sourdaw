import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTrackStoreState } from '../getTrackStoreState';

import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

export type TakeReKeyWriteDirection = 'apply' | 'restore';

function regionKey(region: CompRegion): string {
    return `${region.startBeat}:${region.endBeat}:${region.takeId}`;
}

function regionsOverlap(left: CompRegion, right: CompRegion): boolean {
    return left.startBeat < right.endBeat && right.startBeat < left.endBeat;
}

function isModifiedByTransition(take: Take, other: Take): boolean {
    return (
        take.clipId !== other.clipId ||
        take.startBeat !== other.startBeat ||
        take.endBeat !== other.endBeat ||
        take.name !== other.name ||
        take.sourceOffsetBeats !== other.sourceOffsetBeats
    );
}

/**
 * The takes facet of one lane, reconciled toward the transition's target side.
 *
 * The rule set mirrors `reconcileLane`'s: only the transition's own deltas
 * move. A take the transform removed leaves; a take it added comes back when
 * its clip is live (a take whose clip is gone has no material to resolve
 * against — the liveness rule every take replay follows); a take it re-keyed,
 * split, trimmed, or shifted takes the target side's fields, except `selected`
 * — interaction state the operation never owns, so a live toggle survives
 * either direction. A take identical on both sides (including one the paired
 * retirement removes: it is verbatim in both captures) is never touched here,
 * and a take the transition never heard of — a collaborator's write that
 * landed after the capture — survives untouched.
 *
 * `requireLiveClipIds` answers the liveness question, computing the
 * project-wide clip-id set on first use and caching it for the rest of the
 * write: a reconcile that only moves or drops takes never triggers the scan.
 */
function reconcileTransitionTakes(
    live: readonly Take[],
    fromTakes: readonly Take[],
    toTakes: readonly Take[],
    requireLiveClipIds: () => ReadonlySet<string>
): readonly Take[] {
    const fromIds = new Set(fromTakes.map((take) => take.id));
    const fromById = new Map(fromTakes.map((take) => [take.id, take]));
    const toById = new Map(toTakes.map((take) => [take.id, take]));
    const liveById = new Map(live.map((take) => [take.id, take]));
    const modifiedIds = new Set<string>();
    for (const target of toTakes) {
        const source = fromById.get(target.id);
        if (source && isModifiedByTransition(target, source)) {
            modifiedIds.add(target.id);
        }
    }
    let liveClipIds: ReadonlySet<string> | null = null;

    const reconciled: Take[] = [];
    for (const target of toTakes) {
        const liveTake = liveById.get(target.id);
        if (!liveTake) {
            if (liveClipIds === null) {
                liveClipIds = requireLiveClipIds();
            }
            if (liveClipIds.has(target.clipId)) {
                reconciled.push(structuredClone(target));
            }
            continue;
        }
        if (modifiedIds.has(target.id)) {
            reconciled.push({ ...target, selected: liveTake.selected });
            continue;
        }
        reconciled.push(liveTake);
    }
    for (const liveTake of live) {
        if (!fromIds.has(liveTake.id) && !toById.has(liveTake.id)) {
            reconciled.push(liveTake);
        }
    }
    return reconciled;
}

/**
 * Merge the additions into the kept live regions — both sorted by start — in
 * one linear walk: an addition that overlaps a region already retained, live
 * or re-added, is refused. That is the non-overlap law the store itself keeps,
 * so a comp authored after the capture is never displaced by the replay.
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
        const previous = merged[merged.length - 1];
        if (previous && regionsOverlap(previous, addition)) {
            collides = true;
        }
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
function reconcileTransitionRegions(
    live: readonly CompRegion[],
    fromRegions: readonly CompRegion[],
    toRegions: readonly CompRegion[],
    takes: readonly Take[]
): readonly CompRegion[] {
    const fromKeys = new Set(fromRegions.map(regionKey));
    const toKeys = new Set(toRegions.map(regionKey));
    const liveTakeIds = new Set(takes.map((take) => take.id));

    const kept = live.filter((region) => !fromKeys.has(regionKey(region)) || toKeys.has(regionKey(region)));
    const additions = toRegions.filter(
        (region) =>
            !fromKeys.has(regionKey(region)) && region.endBeat > region.startBeat && liveTakeIds.has(region.takeId)
    );
    return mergeRegionsRefusingOverlaps(kept, additions);
}

function takesMatch(left: readonly Take[], right: readonly Take[]): boolean {
    return (
        left.length === right.length &&
        left.every((take, index) => {
            const other = right[index]!;
            return (
                take.id === other.id &&
                take.clipId === other.clipId &&
                take.name === other.name &&
                take.startBeat === other.startBeat &&
                take.endBeat === other.endBeat &&
                take.selected === other.selected &&
                take.sourceOffsetBeats === other.sourceOffsetBeats
            );
        })
    );
}

function regionsMatch(left: readonly CompRegion[], right: readonly CompRegion[]): boolean {
    return (
        left.length === right.length &&
        left.every((region, index) => {
            const other = right[index]!;
            return (
                region.startBeat === other.startBeat &&
                region.endBeat === other.endBeat &&
                region.takeId === other.takeId
            );
        })
    );
}

function reconcileLaneTransition(
    lane: TakeLane,
    transition: TakeReKeyLaneTransition,
    direction: TakeReKeyWriteDirection,
    requireLiveClipIds: () => ReadonlySet<string>
): TakeLane | null {
    const fromTakes = direction === 'apply' ? transition.takesBefore : transition.takesAfter;
    const toTakes = direction === 'apply' ? transition.takesAfter : transition.takesBefore;
    const fromRegions = direction === 'apply' ? transition.regionsBefore : transition.regionsAfter;
    const toRegions = direction === 'apply' ? transition.regionsAfter : transition.regionsBefore;

    const takes = reconcileTransitionTakes(lane.takes, fromTakes, toTakes, requireLiveClipIds);
    const regions = reconcileTransitionRegions(lane.activeCompRegions, fromRegions, toRegions, takes);
    if (takesMatch(lane.takes, takes) && regionsMatch(lane.activeCompRegions, regions)) {
        return null;
    }
    return { ...lane, takes: [...takes], activeCompRegions: [...regions] };
}

/**
 * Write one side of every captured re-key transition into the store, in one
 * atomic write. `apply` reproduces the post-operation facets (the forward
 * operation's own publish, and the redo leg of its restore plan); `restore`
 * puts the pre-operation facets back (the undo leg). Each lane reconciles
 * against live state rather than overwriting it, so a diverged store degrades
 * to a partial replay instead of a clobbered one, and a transition whose work
 * is already the live state costs no write.
 */
export function writeTakeReKeyTransitions(
    transitions: readonly TakeReKeyLaneTransition[],
    direction: TakeReKeyWriteDirection
): void {
    const state = takeLaneStore.value;
    if (!state || transitions.length === 0) {
        return;
    }

    // The clip ids currently in the project, collected once per write and only
    // when some lane actually re-adds a take: the per-take liveness checks
    // share one scan instead of rebuilding per-track clip lists per take.
    let liveClipIds: Set<string> | null = null;
    const requireLiveClipIds = (): ReadonlySet<string> => {
        if (liveClipIds === null) {
            const collected = new Set<string>();
            for (const track of getTrackStoreState()?.tracks ?? []) {
                for (const clipId of collectTrackClipIds(track)) {
                    collected.add(clipId);
                }
            }
            liveClipIds = collected;
        }
        return liveClipIds;
    };

    const lanes = [...state.lanes];
    let changed = false;
    for (const transition of transitions) {
        // The captured lane's own id, or the lane its track now owns — the
        // identity rule the retirement restore uses, so the two legs of one
        // operation never disagree about which lane they mean.
        const targetIndex = lanes.findIndex(
            (candidate) => candidate.id === transition.laneId || candidate.trackId === transition.trackId
        );
        if (targetIndex === -1) {
            continue;
        }
        const reconciled = reconcileLaneTransition(lanes[targetIndex]!, transition, direction, requireLiveClipIds);
        if (reconciled) {
            lanes[targetIndex] = reconciled;
            changed = true;
        }
    }

    if (changed) {
        takeLaneStore.set({ lanes });
    }
}
