import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { discardRecording } from '../../useCases/recording/discardRecording';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type DiscardRecordingAction = Extract<AppAction, { type: 'discardRecording' }>;

function recordedClipExists(action: DiscardRecordingAction): boolean {
    return (
        getTrackStoreState()?.tracks.some((track) => track.clips.some((clip) => clip.id === action.payload.clipId)) ===
        true
    );
}

/**
 * Inverse of `commitRecording`: retire the recorded clip and the takes that name
 * it through the ordinary clip-removal use case, so a lane this recording opened
 * whole is retired with its last take while a lane that predates the recording
 * keeps every take that does not name the clip. `discardRecording` is the same
 * retirement a failed commit runs, so the two can never disagree.
 */
export const handleDiscardRecording = createHandler<'discardRecording'>({
    validate: recordedClipExists,
    execute: (action) => toHandlerExecutionResult(discardRecording(action.payload.clipId)),
    describe: () => ({ label: 'Discard recording' }),
    undoable: false,
});
