import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { type Clip } from '../../models/Track';
import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';
import { updateTrack } from '../../useCases/updateTrack';

import { recordingRestoreTargetIsClear } from './recordingReplayOwnership';

/**
 * Explicit redo of `commitRecording`. Replays the clip, the take-lane state the
 * removal retired, and the clip's MIDI data, so the same clip id, placement,
 * take membership, and notes come back without a second capture. The clip is
 * re-appended only when it is absent — never duplicated — and
 * `restoreTakesForClip` reconciles the retired takes into whatever lane the
 * track holds now, so a later edit to that lane survives.
 */
export const handleRestoreRecording = createHandler<'restoreRecording'>({
    validate: recordingRestoreTargetIsClear,
    execute: (action, context) => {
        if (!recordingRestoreTargetIsClear(action, context)) {
            return { status: 'conflict' };
        }
        const { clip, retiredTakeLanes, midiNotesSnapshot, midiCcSnapshot, midiPitchBendSnapshot } = action.payload;
        const { kneadState, ...snapshot } = structuredClone(clip);
        const recorded: Clip = snapshot;
        if (kneadState) {
            recorded.kneadState = {
                ...kneadState,
                blobs: kneadState.blobs.map((blob) => ({ ...blob, pitchCurveCents: [...blob.pitchCurveCents] })),
            };
        }
        updateTrack(clip.trackId, (time) => ({ ...time, clips: [...time.clips, recorded] }));
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
