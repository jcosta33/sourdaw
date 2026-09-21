import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';

/** Touching regions (`left.endBeat === right.startBeat`) do not overlap, matching
 *  the store's own retention, which keeps a region whose start is at the
 *  previous region's end. */
function regionsOverlap(left: CompRegion, right: CompRegion): boolean {
    return left.startBeat < right.endBeat && right.startBeat < left.endBeat;
}

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
 * it after the capture survives. Re-added regions are restricted to those naming a
 * re-added take, so a region removed later is not resurrected either; and a
 * re-added region that overlaps any live region is dropped, because the lane store
 * keeps only non-overlapping regions and would otherwise discard whichever of the
 * two it reaches second — the comp authored after the removal. That overlap test is
 * also what de-duplicates a region the live lane already holds at the same span: a
 * same-span region overlaps itself, and a zero-length region (which
 * `compRegionInterval`'s `endBeat > startBeat` law never produces) is the only shape
 * it could not absorb. Order follows the capture for the takes it knows and appends
 * the live-only ones; regions are ordered by beat, as the store's own shape
 * requires.
 */
export function reconcileLane(live: TakeLane, captured: TakeLane, retiredTakeIds: readonly string[]): TakeLane | null {
    const retiredTakeIdSet = new Set(retiredTakeIds);
    const liveTakesById = new Map(live.takes.map((take) => [take.id, take]));

    const reAddedTakeIds = new Set<string>();
    const takes: Take[] = [];
    for (const take of captured.takes) {
        const liveTake = liveTakesById.get(take.id);
        if (liveTake !== undefined) {
            takes.push(liveTake);
            continue;
        }
        if (retiredTakeIdSet.has(take.id)) {
            takes.push(structuredClone(take));
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
            reAddedTakeIds.has(region.takeId) &&
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
