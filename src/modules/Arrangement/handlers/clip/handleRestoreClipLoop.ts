import { createHandler } from '#/utils/createHandler';

import { setClipLoop } from '../../useCases/clipLoop/setClipLoop';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type ClipLoopState = { present: boolean; enabled: boolean; audioLoopStartSeconds?: number | null };

function readClipLoopState(clip: { loopEnabled?: boolean; audioLoopStartSeconds?: number }): ClipLoopState {
    return {
        present: clip.loopEnabled !== undefined,
        enabled: clip.loopEnabled ?? false,
        audioLoopStartSeconds: clip.audioLoopStartSeconds ?? null,
    };
}

function statesMatch(left: ClipLoopState, right: ClipLoopState): boolean {
    return (
        left.present === right.present &&
        left.enabled === right.enabled &&
        (right.audioLoopStartSeconds === undefined ||
            Object.is(left.audioLoopStartSeconds, right.audioLoopStartSeconds))
    );
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
        // The anchor state rides only in entries recorded after the field
        // could carry it: absent decodes a legacy entry, which replays exactly
        // the call — and the enable restamp — it always did; `null` records a
        // captured clip that carried no anchor and removes any key the forward
        // action minted; a value puts the captured anchor back (#5198).
        return toHandlerExecutionResult(
            setClipLoop(action.payload.clipId, enabled, replacement.loopOriginBeat, replacement.audioLoopStartSeconds)
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
