import { type AppAction } from '#/utils/handlerContract';

import { projectedTakeLaneOwners } from './projectedTakeLaneOwners';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

export function reKeyedTakeLaneOwnersMatchStore(
    transitions: readonly TakeReKeyLaneTransition[],
    direction: 'apply' | 'restore',
    priorActions: readonly AppAction[] = []
): boolean {
    const lanes = projectedTakeLaneOwners(priorActions);
    return transitions.every((transition) => {
        const target = lanes.find((live) => live.id === transition.laneId || live.trackId === transition.trackId);
        const from = direction === 'apply' ? transition.takesBefore : transition.takesAfter;
        const to = direction === 'apply' ? transition.takesAfter : transition.takesBefore;
        const expected = new Map(to.map((take) => [take.id, take.clipId]));
        // An existing id belongs to the source side on this replay leg. Only
        // a minted target id has no source owner; reserve that id globally too.
        for (const take of from) {
            expected.set(take.id, take.clipId);
        }
        return (
            lanes.every((live) => live.id !== transition.laneId || live.trackId === transition.trackId) &&
            lanes.every((live) =>
                live.takes.every(
                    (take) => !expected.has(take.id) || (live === target && take.clipId === expected.get(take.id))
                )
            )
        );
    });
}
