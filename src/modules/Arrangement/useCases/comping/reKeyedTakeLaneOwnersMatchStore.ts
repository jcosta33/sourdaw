import { type AppAction, type TakeReKeyLaneTransitionSnapshot } from '#/utils/handlerContract';

import { projectedTakeLaneOwners } from './projectedTakeLaneOwners';

export function reKeyedTakeLaneOwnersMatchStore(
    transitions: readonly TakeReKeyLaneTransitionSnapshot[],
    priorActions: readonly AppAction[] = []
): boolean {
    const lanes = projectedTakeLaneOwners(priorActions);
    return transitions.every((transition) =>
        lanes.every((live) => live.id !== transition.laneId || live.trackId === transition.trackId)
    );
}
