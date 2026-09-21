import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

function regionKey(region: CompRegion): string {
    return `${region.startBeat}:${region.endBeat}:${region.takeId}`;
}

/**
 * The captured pre-removal lane reconciled onto the live one, or null when live
 * already holds everything the capture would re-add.
 *
 * Exactly two things come back from the capture: a take this removal retired
 * (`retiredTakeIds`) that live no longer holds, and a comp region naming such a
 * take. Everything live stays. That is what makes the undo safe against material
 * that changed after the capture: the store is CRDT-backed, so a collaborator's
 * write — a take-add or a take-deletion — can land on this lane with no local
 * undo entry, and an undo that swapped the whole lane for the capture would undo
 * that write as well. A captured take missing from live for a reason this removal
 * never recorded therefore stays absent rather than being resurrected.
 *
 * A captured take the live lane still holds is taken from live, so an edit made to
 * it after the capture survives. Re-added regions are restricted to those naming a
 * re-added take, so a region removed later is not resurrected either. Order follows
 * the capture for the takes it knows and appends the live-only ones; regions are
 * ordered by beat, as the store's own shape requires.
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

    const liveRegionKeys = new Set(live.activeCompRegions.map(regionKey));
    const restoredRegions = captured.activeCompRegions.filter(
        (region) => reAddedTakeIds.has(region.takeId) && !liveRegionKeys.has(regionKey(region))
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
 * retired whole is inserted at its captured index only when its track has no
 * lane; if a lane for that track appeared while the capture was absent, the
 * retired takes merge into it instead, because a second lane for one track is a
 * state every other creation path forbids and no resolver can read. Every other
 * lane is left alone. A no-op when the store is absent, nothing was retired, or
 * the live state already holds everything the capture would re-add.
 */
export function restoreTakesForClip(retiredLanes: readonly RetiredTakeLaneSnapshot[]): void {
    const state = takeLaneStore.value;
    if (!state || retiredLanes.length === 0) {
        return;
    }

    const lanes = [...state.lanes];
    let changed = false;
    for (const { lane, laneIndex, retiredTakeIds } of retiredLanes) {
        // The captured lane's own id, or the lane its track now owns — the same
        // identity rule the cut-route guard uses, so the two can never disagree
        // about which lane the restore/redo is about.
        const targetIndex = lanes.findIndex(
            (candidate) => candidate.id === lane.id || candidate.trackId === lane.trackId
        );
        if (targetIndex === -1) {
            lanes.splice(Math.min(Math.max(laneIndex, 0), lanes.length), 0, structuredClone(lane));
            changed = true;
            continue;
        }

        const reconciled = reconcileLane(lanes[targetIndex]!, lane, retiredTakeIds ?? []);
        if (reconciled) {
            lanes[targetIndex] = reconciled;
            changed = true;
        }
    }

    if (changed) {
        takeLaneStore.set({ lanes });
    }
}
