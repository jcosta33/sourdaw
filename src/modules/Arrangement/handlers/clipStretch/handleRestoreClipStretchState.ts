import { createHandler } from '#/utils/createHandler';
import { type AppAction, type ClipStretchStateSnapshot } from '#/utils/handlerContract';

import { restoreClipStretchState } from '../../useCases/clipStretch/restoreClipStretchState';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type StretchableClip = {
    endBeat: number;
    startBeat: number;
    stretchMode?: 'off' | 'repitch' | 'timestretch';
    stretchRatio?: number;
};

type RestoreClipStretchStateAction = Extract<AppAction, { type: 'restoreClipStretchState' }>;

function readStretchState(clip: StretchableClip): ClipStretchStateSnapshot {
    return {
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        mode: { present: clip.stretchMode !== undefined, value: clip.stretchMode ?? 'off' },
        ratio: { present: clip.stretchRatio !== undefined, value: clip.stretchRatio ?? 1 },
    };
}

function statesMatch(left: ClipStretchStateSnapshot, right: ClipStretchStateSnapshot): boolean {
    return (
        Object.is(left.startBeat, right.startBeat) &&
        Object.is(left.endBeat, right.endBeat) &&
        left.mode.present === right.mode.present &&
        left.mode.value === right.mode.value &&
        left.ratio.present === right.ratio.present &&
        Object.is(left.ratio.value, right.ratio.value)
    );
}

/** Same precondition `execute` writes against, reused by `validate` so a batch preflight refuses
 *  a diverged stretch/repitch geometry instead of executing into a silent overwrite. */
function expectedStretchStateMatches(action: RestoreClipStretchStateAction): boolean {
    const clip = getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === action.payload.clipId);
    return clip !== undefined && statesMatch(readStretchState(clip), action.payload.expected);
}

export const handleRestoreClipStretchState = createHandler<'restoreClipStretchState'>({
    // `expected` is mandatory on this payload — `restoreClipStretchState` is a single-purpose
    // internal inverse, never a user-issued forward action, so every instance carries a real
    // precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: expectedStretchStateMatches,
    execute: (action) => {
        if (!expectedStretchStateMatches(action)) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(
            restoreClipStretchState({ clipId: action.payload.clipId, state: action.payload.replacement })
        );
    },
    describe: () => ({ label: 'Restore clip stretch state', inverseAction: null }),
    isNoop: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return clip ? statesMatch(readStretchState(clip), action.payload.replacement) : false;
    },
    undoable: false,
});
