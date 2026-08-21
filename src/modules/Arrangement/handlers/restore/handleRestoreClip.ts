import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { undoRippleDelete } from '../../useCases/rippleDelete/undoRippleDelete';
import { updateTrack } from '../../useCases/updateTrack';

/**
 * Inverse-action handler for `removeClip`. Replays snapshot data carried in the
 * action payload — does not compute state itself.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */
export const handleRestoreClip = createHandler<'restoreClip'>({
    execute: (alpha) => {
        const { clipId, trackId, clipSnapshot, ripplePlan, midiNotesSnapshot, midiCcSnapshot, midiPitchBendSnapshot } =
            alpha.payload;

        if (ripplePlan) {
            undoRippleDelete({
                trackId,
                removedClips: ripplePlan.removedClips as never,
                shiftedClips: ripplePlan.shiftedClips as never,
                clipSatellites: ripplePlan.clipSatellites as never,
                clipAutomationLanes: ripplePlan.clipAutomationLanes as never,
            });
        } else {
            updateTrack(trackId, (time) => ({ ...time, clips: [...time.clips, clipSnapshot as never] }));
        }

        restoreMidiClipData({
            clipId,
            notesSnapshot: midiNotesSnapshot,
            controlChangeSnapshot: midiCcSnapshot,
            pitchBendSnapshot: midiPitchBendSnapshot,
        });
    },
    describe: () => ({ label: 'Restore clip' }),
    undoable: false,
});
