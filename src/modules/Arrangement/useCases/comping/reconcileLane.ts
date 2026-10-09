import { type Take, type TakeLane } from '../../models/TakeLane';

import { regionsOverlap } from './regionsOverlap';

/**
 * The captured pre-removal lane reconciled onto the live one, or null when live
 * already holds everything the capture would re-add.
 *
 * Exactly two things come back from the capture: a take this removal retired
 * (`retiredTakeIds`) that live no longer holds, and a comp region naming such a
 * take. Everything live stays. That is what makes the undo safe against material
 * that changed after the capture: the store is CRDT-backed, so a collaborator's
 * write — a take-add, a take-deletion or a comp region — can land on this lane
 * with no local undo entry, and an undo that swapped the whole lane for the
 * capture would undo that write as well. A captured take missing from live for a
 * reason this removal never recorded therefore stays absent rather than being
 * resurrected.
 *
 * A captured take the live lane still holds is taken from live, so an edit made to
 * it after the capture survives. A re-added region is one naming a take this removal
 * retired — the same set the takes come back from, because the removal is what deleted
 * the region — and it is restored only for a take the reconciled lane ends up holding:
 * one re-added here, or one a projection put back while the capture was absent, whose
 * region this undo is then the only thing that can restore. A region for a take the
 * removal never touched stays gone, and a region for a retired take that is neither live
 * nor in the capture is dropped rather than left dangling — a region naming a take the
 * lane does not hold still advances the resolver's gap cursor over its span. A re-added
 * region that overlaps any live region is dropped too, because the lane store keeps
 * only non-overlapping regions and would otherwise discard whichever of the two it
 * reaches second — the comp authored after the removal. That overlap test is also what
 * de-duplicates a region the live lane already holds at the same span: a same-span
 * region overlaps itself, and a zero-length region (which `compRegionInterval`'s
 * `endBeat > startBeat` law never produces) is the only shape it could not absorb.
 * Order follows the capture for the takes it knows and appends the live-only ones;
 * regions are ordered by beat, as the store's own shape requires. A live selection
 * takes precedence over a restored take's captured selection. When live has no
 * selection, at most one restored selected take regains it.
 */
export function reconcileLane(live: TakeLane, captured: TakeLane, retiredTakeIds: readonly string[]): TakeLane | null {
    const retiredTakeIdSet = new Set(retiredTakeIds);
    const liveTakesById = new Map(live.takes.map((take) => [take.id, take]));

    const reAddedTakeIds = new Set<string>();
    const takes: Take[] = [];
    let hasSelectedTake = live.takes.some((take) => take.selected);
    for (const take of captured.takes) {
        const liveTake = liveTakesById.get(take.id);
        if (liveTake !== undefined) {
            takes.push(liveTake);
            continue;
        }
        if (retiredTakeIdSet.has(take.id)) {
            const restored = structuredClone(take);
            restored.selected = take.selected && !hasSelectedTake;
            hasSelectedTake = hasSelectedTake || restored.selected;
            takes.push(restored);
            reAddedTakeIds.add(take.id);
        }
    }
    const capturedTakeIds = new Set(captured.takes.map((take) => take.id));
    for (const take of live.takes) {
        if (!capturedTakeIds.has(take.id)) {
            takes.push(take);
        }
    }

    const restoredRegions = captured.activeCompRegions.filter(
        (region) =>
            retiredTakeIdSet.has(region.takeId) &&
            (reAddedTakeIds.has(region.takeId) || liveTakesById.has(region.takeId)) &&
            !live.activeCompRegions.some((liveRegion) => regionsOverlap(liveRegion, region))
    );

    if (reAddedTakeIds.size === 0 && restoredRegions.length === 0) {
        return null;
    }

    return {
        ...live,
        takes,
        activeCompRegions: [...live.activeCompRegions, ...restoredRegions].sort(
            (alpha, buffer) => alpha.startBeat - buffer.startBeat
        ),
    };
}
