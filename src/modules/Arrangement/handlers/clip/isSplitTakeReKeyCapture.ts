import { type TakeReKeyLaneTransitionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { isReKeyLaneTransition } from '../../useCases/timeOperations/isReKeyLaneTransition';

function foreignTakesUnchanged(
    takes: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['takesBefore'][number]>,
    otherTakes: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['takesAfter'][number]>,
    clipId: string,
    rightClipId: string
): boolean {
    return takes.every(
        (take) =>
            take.clipId === clipId ||
            take.clipId === rightClipId ||
            valuesEqual(
                take,
                otherTakes.find((other) => other.id === take.id)
            )
    );
}

function foreignRegionsUnchanged(
    regions: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['regionsBefore'][number]>,
    otherRegions: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['regionsAfter'][number]>,
    takes: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['takesBefore'][number]>,
    clipId: string,
    rightClipId: string
): boolean {
    return regions.every((region) => {
        const take = takes.find((candidate) => candidate.id === region.takeId);
        return (
            take?.clipId === clipId ||
            take?.clipId === rightClipId ||
            otherRegions.some((other) => valuesEqual(region, other))
        );
    });
}

export function isSplitTakeReKeyCapture(value: unknown, trackId: string, clipId: string, rightClipId: string): boolean {
    if (value === undefined) {
        return true;
    }
    if (!Array.isArray(value) || !value.every(isReKeyLaneTransition)) {
        return false;
    }
    const laneIds = new Set<string>();
    for (const transition of value) {
        if (transition.trackId !== trackId || laneIds.has(transition.laneId)) {
            return false;
        }
        laneIds.add(transition.laneId);
        if (
            !foreignTakesUnchanged(transition.takesBefore, transition.takesAfter, clipId, rightClipId) ||
            !foreignTakesUnchanged(transition.takesAfter, transition.takesBefore, clipId, rightClipId) ||
            !foreignRegionsUnchanged(
                transition.regionsBefore,
                transition.regionsAfter,
                transition.takesBefore,
                clipId,
                rightClipId
            ) ||
            !foreignRegionsUnchanged(
                transition.regionsAfter,
                transition.regionsBefore,
                transition.takesAfter,
                clipId,
                rightClipId
            )
        ) {
            return false;
        }
    }
    return true;
}
