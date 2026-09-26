import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';

import { laneTrackExists } from './laneTrackExists';
import { reconcileLane } from './reconcileLane';
import { takesWithLiveClips } from './takesWithLiveClips';

/**
 * Put back the take-lane state a clip removal retired, in one atomic store
 * write.
 *
 * Each entry is a lane exactly as it stood before the removal, at the index it
 * held, plus the take ids that removal retired. A lane still present is
 * reconciled: a retired take live no longer holds comes back, the region the
 * removal deleted comes back with the take the lane ends up holding, and
 * everything live is kept — so takes and regions a collaborator's projection
 * added or removed after the capture survive, without the region a projection
 * already put the take back for being left behind. A lane absent from live is
 * inserted at its captured index when its track has no lane, carrying only the
 * retired takes and regions, reconciled against an empty lane so nothing the
 * removal did not retire rides back in; if a lane for that track appeared while
 * the capture was absent, the retired takes merge into it instead, because a
 * second lane for one track is dead state no resolver can read and every route
 * that creates a lane forbids it — `handleRestoreTrack` included, which puts its
 * captured lanes back through the same shared insert (`insertTakeLane`). Every other lane is left alone. A no-op when the store is
 * absent, nothing was retired, or the live state already holds everything the
 * capture would re-add.
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
