import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

type RestoreRecordingAction = Extract<AppAction, { type: 'restoreRecording' }>;

function restorationTargetIsClear(action: RestoreRecordingAction): boolean {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.clip.trackId);
    return track !== undefined && !track.clips.some((clip) => clip.id === action.payload.clip.id);
}

/**
 * Explicit redo of `commitRecording`. Replays the clip, the take-lane state the
 * removal retired, and the clip's MIDI data, so the same clip id, placement,
 * take membership, and notes come back without a second capture. The clip is
 * re-appended only when it is absent — never duplicated — and
 * `restoreTakesForClip` reconciles the retired takes into whatever lane the
 * track holds now, so a later edit to that lane survives.
 */
export const handleRestoreRecording = createHandler<'restoreRecording'>({
    validate: restorationTargetIsClear,
    execute: (action) => {
        const { clip, retiredTakeLanes, midiNotesSnapshot, midiCcSnapshot, midiPitchBendSnapshot } = action.payload;
        if (restorationTargetIsClear(action)) {
            const recorded = structuredClone(clip) as never;
            updateTrack(clip.trackId, (time) => ({ ...time, clips: [...time.clips, recorded] }));
        }
        restoreTakesForClip(retiredTakeLanes);
        restoreMidiClipData({
            clipId: clip.id,
            notesSnapshot: midiNotesSnapshot,
            controlChangeSnapshot: midiCcSnapshot,
            pitchBendSnapshot: midiPitchBendSnapshot,
        });
    },
    describe: () => ({ label: 'Restore recording' }),
    undoable: false,
});
