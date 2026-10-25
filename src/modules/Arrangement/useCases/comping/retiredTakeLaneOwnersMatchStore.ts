import { type AppAction, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { projectedTakeLaneOwners } from './projectedTakeLaneOwners';

/**
 * A captured lane can be absent or replaced by a new lane for its track. Its
 * old id cannot name another track's lane: restoreTakesForClip resolves by id
 * as well as track. Preflight this before restoring any of the clip's owners,
 * including after hydration when a peer can have reused the retired identity.
 * Retired take ids are global too: a live occupant must still name the captured
 * clip inside the lane the restore will reconcile, never another peer's take.
 */
export function retiredTakeLaneOwnersMatchStore(
    retiredLanes: readonly RetiredTakeLaneSnapshot[],
    priorActions: readonly AppAction[] = []
): boolean {
    const lanes = projectedTakeLaneOwners(priorActions);
    return retiredLanes.every(({ lane, retiredTakeIds }) => {
        const target = lanes.find((live) => live.id === lane.id || live.trackId === lane.trackId);
        return (
            lanes.every((live) => live.id !== lane.id || live.trackId === lane.trackId) &&
            lane.takes
                .filter((take) => retiredTakeIds?.includes(take.id))
                .every((captured) =>
                    lanes.every((live) =>
                        live.takes.every(
                            (take) => take.id !== captured.id || (live === target && take.clipId === captured.clipId)
                        )
                    )
                )
        );
    });
}
