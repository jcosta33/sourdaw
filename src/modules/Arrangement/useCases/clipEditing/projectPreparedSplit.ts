import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { projectedTakeLaneOwners } from '../comping/projectedTakeLaneOwners';

import { preparedClipSplits } from './preparedClipSplit';
import { projectSplitRestore } from './projectSplitRestore';
import { type ShiftedOwnerState } from './ShiftedOwnerState';

export function projectPreparedSplit(
    action: Extract<AppAction, { type: 'splitClip' }>,
    state: ShiftedOwnerState
): ShiftedOwnerState | null {
    const prepared = preparedClipSplits.get(action);
    if (!prepared) {
        return null;
    }
    const owner = state.clips.find((candidate) => candidate.clip.id === action.payload.clipId);
    if (
        !owner ||
        owner.owningTrackId !== prepared.previous.trackId ||
        !valuesEqual(owner.clip, prepared.previous.leftClip)
    ) {
        return null;
    }
    const split = projectSplitRestore(state, {
        clipId: action.payload.clipId,
        rightClipId: prepared.rightClipId,
        expected: prepared.previous,
        replacement: prepared.next,
    });
    if (!split) {
        return null;
    }
    return { ...split, takeLanes: projectedTakeLaneOwners([action], split.takeLanes) };
}
