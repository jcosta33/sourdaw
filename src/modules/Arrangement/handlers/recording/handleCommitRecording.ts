import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type CommitRecordingAction = Extract<AppAction, { type: 'commitRecording' }>;

function owningTrackExists(action: CommitRecordingAction): boolean {
    return getTrackStoreState()?.tracks.some((candidate) => candidate.id === action.payload.clip.trackId) === true;
}

/**
 * Materialize one completed recording gesture into its track, replacing the
 * provisional clip the recorder opened under the same id.
 *
 * The forward write is the clip alone: the take lane and the takes were staged
 * while capture ran, and `describe` — which runs before this write, against the
 * live staged state — captures them into the entry's explicit redo. That is what
 * makes one undo remove the recorded clip and its take-lane membership together,
 * and one redo put the same clip id, placement, and takes back.
 */
export const handleCommitRecording = createHandler<'commitRecording'>({
    validate: owningTrackExists,
    execute: (action) => {
        const { clip } = action.payload;
        if (!owningTrackExists(action)) {
            return toHandlerExecutionResult(false);
        }
        const recorded = structuredClone(clip) as never;
        updateTrack(clip.trackId, (time) => {
            if (!time.clips.some((existing) => existing.id === clip.id)) {
                return { ...time, clips: [...time.clips, recorded] };
            }
            return {
                ...time,
                clips: time.clips.map((existing) => (existing.id === clip.id ? recorded : existing)),
            };
        });
        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        const { clip } = action.payload;
        return {
            label: `Record clip "${clip.name}"`,
            inverseAction: { type: 'discardRecording', payload: { clipId: clip.id } },
            redoAction: {
                type: 'restoreRecording',
                payload: {
                    clip,
                    retiredTakeLanes: captureRetiredTakeLanes([clip.id]),
                },
            },
        };
    },
    undoable: true,
});
