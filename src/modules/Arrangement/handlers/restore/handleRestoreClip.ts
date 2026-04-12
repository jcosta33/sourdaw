import { createHandler } from '#/utils/createHandler';
import { midiStore } from '#/modules/MIDI/stores';
import { updateTrack } from '../../useCases/updateTrack';
import { undoRippleDelete } from '../../useCases/rippleDelete/undoRippleDelete';

/**
 * Inverse-action handler for `removeClip`. Replays snapshot data carried in the
 * action payload — does not compute state itself.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRestoreClip = createHandler<'restoreClip'>({
    execute: (a) => {
        const {
            clipId,
            trackId,
            clipSnapshot,
            ripplePlan,
            midiNotesSnapshot,
            midiCcSnapshot,
            midiPitchBendSnapshot,
        } = a.payload;

        if (ripplePlan) {
            undoRippleDelete({
                trackId,
                removedClips: ripplePlan.removedClips as never,
                shiftedClips: ripplePlan.shiftedClips as never,
            });
        } else {
            updateTrack(trackId, (t) => ({ ...t, clips: [...t.clips, clipSnapshot as never] }));
        }

        const midi = midiStore.value;
        if (midi && (midiNotesSnapshot || midiCcSnapshot || midiPitchBendSnapshot)) {
            midiStore.set({
                notesByClipId: midiNotesSnapshot
                    ? { ...midi.notesByClipId, [clipId]: midiNotesSnapshot as never }
                    : midi.notesByClipId,
                ccByClipId: midiCcSnapshot
                    ? { ...midi.ccByClipId, [clipId]: midiCcSnapshot as never }
                    : midi.ccByClipId,
                pitchBendByClipId: midiPitchBendSnapshot
                    ? { ...midi.pitchBendByClipId, [clipId]: midiPitchBendSnapshot as never }
                    : midi.pitchBendByClipId,
            });
        }
    },
    describe: () => ({ label: 'Restore clip' }),
    undoable: false,
});
