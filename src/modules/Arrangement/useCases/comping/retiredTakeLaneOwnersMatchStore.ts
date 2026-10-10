import { type AppAction, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { projectedTakeLaneOwners } from './projectedTakeLaneOwners';

/**
 * A captured lane can be absent or replaced by a new lane for its track. Its
 * old id cannot name another track's lane: restoreTakesForClip resolves by id
 * as well as track. Preflight this before restoring any of the clip's owners,
 * including after hydration when a peer can have reused the retired identity.
 */
export function retiredTakeLaneOwnersMatchStore(
    retiredLanes: readonly RetiredTakeLaneSnapshot[],
    priorActions: readonly AppAction[] = []
): boolean {
    const lanes = projectedTakeLaneOwners(priorActions);
    return retiredLanes.every(({ lane }) =>
        lanes.every((live) => live.id !== lane.id || live.trackId === lane.trackId)
    );
}
