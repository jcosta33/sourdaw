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
        // The captured anchor rides only in entries recorded after the field
        // existed: a legacy entry decodes without it and replays exactly the
        // call — and the enable restamp — it always did (#5198). The value is
        // read by the enable branch alone; disable and clear ignore it.
        return toHandlerExecutionResult(
            replacement.loopOriginBeat === undefined
                ? setClipLoop(action.payload.clipId, enabled)
                : setClipLoop(action.payload.clipId, enabled, replacement.loopOriginBeat)
        );
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
