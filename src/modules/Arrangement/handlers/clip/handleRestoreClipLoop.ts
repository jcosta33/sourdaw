import { createHandler } from '#/utils/createHandler';

import { setClipLoop } from '../../useCases/clipLoop/setClipLoop';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type ClipLoopState = { present: boolean; enabled: boolean };

function readClipLoopState(clip: { loopEnabled?: boolean }): ClipLoopState {
    return { present: clip.loopEnabled !== undefined, enabled: clip.loopEnabled ?? false };
}

function statesMatch(left: ClipLoopState, right: ClipLoopState): boolean {
    return left.present === right.present && left.enabled === right.enabled;
}

export const handleRestoreClipLoop = createHandler<'restoreClipLoop'>({
    execute: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (!clip || !statesMatch(readClipLoopState(clip), action.payload.expected)) {
            return { status: 'conflict' };
        }

        const replacement = action.payload.replacement;
        const enabled = replacement.present ? replacement.enabled : undefined;
        return toHandlerExecutionResult(setClipLoop(action.payload.clipId, enabled));
    },
    describe: () => ({ label: 'Restore clip loop state', inverseAction: null }),
    isNoop: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return clip ? statesMatch(readClipLoopState(clip), action.payload.replacement) : false;
    },
    undoable: false,
});
