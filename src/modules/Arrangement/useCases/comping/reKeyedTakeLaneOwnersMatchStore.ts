import { type AppAction, type TakeReKeyLaneTransitionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type Take } from '../../models/TakeLane';

import { projectedTakeLaneOwners } from './projectedTakeLaneOwners';

function replayFacets(take: Take): Record<string, unknown> {
    return Object.fromEntries(Object.entries(take).filter(([key, value]) => key !== 'selected' && value !== undefined));
}

export function reKeyedTakeLaneOwnersMatchStore(
    transitions: readonly TakeReKeyLaneTransitionSnapshot[],
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
        const targetTakes = new Map(to.map((take) => [take.id, take]));
        return (
            lanes.every((live) => live.id !== transition.laneId || live.trackId === transition.trackId) &&
            lanes.every((live) =>
                live.takes.every(
                    (take) => !expected.has(take.id) || (live === target && take.clipId === expected.get(take.id))
                )
            ) &&
            from.every((source) => {
                const destination = targetTakes.get(source.id);
                // A retained, unchanged take is preserved by the writer. For a
                // take it replaces or removes, refuse if later media edits no
                // longer match the captured source; selection remains live.
                if (destination && valuesEqual(replayFacets(source), replayFacets(destination))) {
                    return true;
                }
                const live = target?.takes.find((take) => take.id === source.id);
                return !live || valuesEqual(replayFacets(live), replayFacets(source));
            })
        );
    });
}
