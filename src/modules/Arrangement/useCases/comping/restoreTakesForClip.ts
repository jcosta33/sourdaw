import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { laneTrackExists } from './laneTrackExists';
import { takesWithLiveClips } from './takesWithLiveClips';

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
function reconcileLane(live: TakeLane, captured: TakeLane, retiredTakeIds: readonly string[]): TakeLane | null {
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

/**
 * Put back the take-lane state a clip removal retired, in one atomic store
 * write.
 *
 * Each entry is a lane exactly as it stood before the removal, at the index it
 * held, plus the take ids that removal retired. A lane still present is
 * reconciled: only the retired takes it no longer holds — and the regions naming
 * them — are re-added, and everything live is kept, so takes and regions a
 * collaborator's projection added or removed after the capture survive. A lane
 * absent from live is inserted at its captured index when its track has no lane,
 * carrying only the retired takes and regions, reconciled against an empty lane
 * so nothing the removal did not retire rides back in; if a lane for that track
 * appeared while the capture was absent, the retired takes merge into it instead,
 * because a second lane for one track is a state every other creation path
 * forbids and no resolver can read. Every other lane is left alone. A no-op when
 * the store is absent, nothing was retired, or the live state already holds
 * everything the capture would re-add.
 */
export function restoreTakesForClip(retiredLanes: readonly RetiredTakeLaneSnapshot[]): void {
    const state = takeLaneStore.value;
    if (!state || retiredLanes.length === 0) {
        return;
    }

    const lanes = [...state.lanes];
    let changed = false;
    for (const { lane, laneIndex, retiredTakeIds } of retiredLanes) {
        // A lane whose track is gone has no host, and a take whose clip is gone has no
        // material to resolve against: re-inserting either strands state nothing can
        // read — the orphan this retirement work exists to prevent. The guard belongs
        // here rather than at each caller because a single-action undo dispatches its
        // inverse through `executeAppAction`, which never runs the handler's
        // live-state validation, so no caller's own guard is on that path.
        if (!laneTrackExists(lane.trackId)) {
            continue;
        }
        const liveTakeIds = new Set(takesWithLiveClips(lane.takes).map((take) => take.id));
        const residentTakeIds = (retiredTakeIds ?? []).filter((takeId) => liveTakeIds.has(takeId));

        // The captured lane's own id, or the lane its track now owns — the same
        // identity rule the cut-route guard uses, so the two can never disagree
        // about which lane the restore/redo is about.
        const targetIndex = lanes.findIndex(
            (candidate) => candidate.id === lane.id || candidate.trackId === lane.trackId
        );
        if (targetIndex === -1) {
            // The captured lane is gone from live. Reconcile the capture against an
            // empty lane and insert only what the removal retired, so a captured
            // take the removal never touched — or a capture written before
            // `retiredTakeIds` existed — cannot ride back in with the whole clone.
            const inserted = reconcileLane({ ...lane, takes: [], activeCompRegions: [] }, lane, residentTakeIds);
            if (inserted) {
                lanes.splice(Math.min(Math.max(laneIndex, 0), lanes.length), 0, inserted);
                changed = true;
            }
            continue;
        }

        const reconciled = reconcileLane(lanes[targetIndex]!, lane, residentTakeIds);
        if (reconciled) {
            lanes[targetIndex] = reconciled;
            changed = true;
        }
    }

    if (changed) {
        takeLaneStore.set({ lanes });
    }
}
