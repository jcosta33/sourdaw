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
 * Only the takes and comp regions the removal retired are put back; every live
 * take and region stays, including the ones the capture never saw. That is what
 * makes the undo safe against material that arrived after the capture: the store
 * is CRDT-backed, so a collaborator's take-add — or any projection write with no
 * local undo entry — can land on this lane while the removal's capture is absent,
 * and an undo that swapped the whole lane for the capture would delete it.
 *
 * A captured take the live lane still holds is taken from live, so an edit made
 * to it after the capture survives; only a captured take missing from live is
 * re-added from the capture. Re-added regions are restricted to those naming a
 * re-added take, so a region the user (or a peer) removed on purpose is not
 * resurrected. Order follows the capture for the takes it knows and appends the
 * live-only ones; regions are ordered by beat, as the store's own shape requires.
 */
function reconcileLane(live: TakeLane, captured: TakeLane): TakeLane | null {
    const liveTakeIds = new Set(live.takes.map((take) => take.id));
    const liveTakesById = new Map(live.takes.map((take) => [take.id, take]));

    const takes: Take[] = captured.takes.map((take) => liveTakesById.get(take.id) ?? structuredClone(take));
    for (const take of live.takes) {
        if (!captured.takes.some((candidate) => candidate.id === take.id)) {
            takes.push(take);
        }
    }

    const restoredTakeIds = new Set(takes.filter((take) => !liveTakeIds.has(take.id)).map((take) => take.id));
    const liveRegionKeys = new Set(live.activeCompRegions.map(regionKey));
    const restoredRegions = captured.activeCompRegions.filter(
        (region) => restoredTakeIds.has(region.takeId) && !liveRegionKeys.has(regionKey(region))
    );

    if (restoredTakeIds.size === 0 && restoredRegions.length === 0) {
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
 * held. A lane still present is reconciled: the takes and comp regions the
 * removal dropped are re-added, and everything live is kept — takes and regions
 * a collaborator's projection added after the capture survive. A lane retired
 * whole is inserted at its captured index only when its track has no lane; if a
 * lane for that track appeared while the capture was absent, the captured takes
 * merge into it instead, because a second lane for one track is a state every
 * other creation path forbids and no resolver can read. Every other lane is left
 * alone. A no-op when the store is absent, nothing was retired, or the live
 * state already holds everything the capture would re-add.
 */
export function restoreTakesForClip(retiredLanes: readonly RetiredTakeLaneSnapshot[]): void {
    const state = takeLaneStore.value;
    if (!state || retiredLanes.length === 0) {
        return;
    }

    const lanes = [...state.lanes];
    let changed = false;
    for (const { lane, laneIndex } of retiredLanes) {
        // The captured lane's own id, or the lane its track now owns — never both,
        // so a restore cannot leave two lanes for one track.
        const targetIndex = lanes.findIndex(
            (candidate) => candidate.id === lane.id || candidate.trackId === lane.trackId
        );
        if (targetIndex === -1) {
            lanes.splice(Math.min(Math.max(laneIndex, 0), lanes.length), 0, structuredClone(lane));
            changed = true;
            continue;
        }

        const reconciled = reconcileLane(lanes[targetIndex]!, lane);
        if (reconciled) {
            lanes[targetIndex] = reconciled;
            changed = true;
        }
    }

    if (changed) {
        takeLaneStore.set({ lanes });
    }
}
