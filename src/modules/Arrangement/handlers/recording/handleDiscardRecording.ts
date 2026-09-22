import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { removeClip } from '../../useCases/clip/removeClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type DiscardRecordingAction = Extract<AppAction, { type: 'discardRecording' }>;

function clipStillExists(action: DiscardRecordingAction): boolean {
    return (
        getTrackStoreState()?.tracks.some((track) => track.clips.some((clip) => clip.id === action.payload.clipId)) ===
        true
    );
}

/**
 * Inverse of `commitRecording`: retire the recorded clip and the takes that name
 * it through the ordinary clip-removal use case, so a lane this recording opened
 * whole is retired with its last take while a lane that predates the recording
 * keeps every take that does not name the clip.
 */
export const handleDiscardRecording = createHandler<'discardRecording'>({
    validate: clipStillExists,
    execute: (action) => {
        if (!clipStillExists(action)) {
            return toHandlerExecutionResult(false);
        }
        removeClip(action.payload.clipId);
        return toHandlerExecutionResult(true);
    },
    describe: () => ({ label: 'Discard recording' }),
    undoable: false,
});
