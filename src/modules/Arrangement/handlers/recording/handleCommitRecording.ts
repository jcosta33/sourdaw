import { getMidiStoreState } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type Clip } from '../../stores/trackStore';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type CommitRecordingAction = Extract<AppAction, { type: 'commitRecording' }>;

function owningTrackExists(action: CommitRecordingAction): boolean {
    return getTrackStoreState()?.tracks.some((candidate) => candidate.id === action.payload.clip.trackId) === true;
}

/**
 * Materialize one completed recording gesture into its track, updating the
 * provisional clip the recorder opened under the same id.
 *
 * The forward write is the clip alone: the take lane and the takes were staged
 * while capture ran, and `describe` — which runs before this write, against the
 * live staged state — captures them into the entry's explicit redo, together
 * with the clip's MIDI data, which the removal inverse deletes. That is what
 * makes one undo remove the recorded clip, its take-lane membership, and its
 * notes together, and one redo put the same clip id, placement, takes, and notes
 * back. The write updates the live clip rather than replacing it, so a field the
 * payload does not carry survives — the base finalizer's updater could not lose
 * one either.
 */
export const handleCommitRecording = createHandler<'commitRecording'>({
    validate: owningTrackExists,
    execute: (action) => {
        const { clip } = action.payload;
        if (!owningTrackExists(action)) {
            return toHandlerExecutionResult(false);
        }
        const recorded = structuredClone(clip) as Clip;
        updateTrack(clip.trackId, (time) => {
            if (!time.clips.some((existing) => existing.id === clip.id)) {
                return { ...time, clips: [...time.clips, recorded] };
            }
            return {
                ...time,
                clips: time.clips.map((existing) =>
                    existing.id === clip.id ? { ...existing, ...recorded } : existing
                ),
            };
        });
        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        const { clip } = action.payload;
        // The inverse removes the clip through the ordinary removal path, which
        // deletes the clip's MIDI data. Carry it on the redo exactly as the
        // clip-restore route does, so undoing and redoing a recorded MIDI take
        // does not hand back an empty clip.
        const midiState = getMidiStoreState();
        const notes = midiState?.notesByClipId[clip.id];
        const cc = midiState?.ccByClipId[clip.id];
        const pitchBend = midiState?.pitchBendByClipId[clip.id];
        return {
            label: `Record clip "${clip.name}"`,
            inverseAction: { type: 'discardRecording', payload: { clipId: clip.id } },
            redoAction: {
                type: 'restoreRecording',
                payload: {
                    clip,
                    retiredTakeLanes: captureRetiredTakeLanes([clip.id]),
                    midiNotesSnapshot: notes ? structuredClone(notes) : null,
                    midiCcSnapshot: cc ? structuredClone(cc) : null,
                    midiPitchBendSnapshot: pitchBend ? structuredClone(pitchBend) : null,
                },
            },
        };
    },
    undoable: true,
});
