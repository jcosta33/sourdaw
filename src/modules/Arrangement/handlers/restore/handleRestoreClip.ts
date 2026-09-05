import { restoreMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { undoRippleDelete } from '../../useCases/rippleDelete/undoRippleDelete';
import { updateTrack } from '../../useCases/updateTrack';

/**
 * Inverse-action handler for `removeClip`. Replays snapshot data carried in the
 * action payload — does not compute state itself.
 *
 * `undoable: false` — invoked only by undo machinery; must not create new undo entries.
 */

type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;

function restoreStateMatches(action: RestoreClipAction): boolean {
    // The restore re-appends `clipSnapshot` as-is, so it assumes the owning track
    // is present and the removed clip is still absent — re-appending onto a clip
    // that is somehow back would duplicate its id.
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
    return track !== undefined && !track.clips.some((clip) => clip.id === action.payload.clipId);
}

/**
 * Batch members of this handler must be mutually independent — no shared clip
 * target, no track removal or restore inside a clip-member batch — because
 * sequential execution after a pre-state preflight cannot otherwise see a
 * target another member consumes: a second restore of the same clip would
 * re-append a duplicate clip id, and a member that removes or restores this
 * clip's track would leave the two writes racing over one track.
 */
function batchMembersAreIndependent(action: RestoreClipAction, context: HandlerValidationContext): boolean {
    const otherMembers = context.actions.filter((_, index) => index !== context.actionIndex);
    if (otherMembers.length === 0) {
        return true;
    }
    const sharesClipTarget = otherMembers.some(
        (member) =>
            (member.type === 'removeClip' || member.type === 'restoreClip') &&
            member.payload.clipId === action.payload.clipId
    );
    if (sharesClipTarget) {
        return false;
    }
    return !otherMembers.some(
        (member) =>
            (member.type === 'removeTrack' || member.type === 'restoreTrack') &&
            member.payload.trackId === action.payload.trackId
    );
}

export const handleRestoreClip = createHandler<'restoreClip'>({
    // Grouped undo replays every inverse of the gesture as one batch; this
    // preflight keeps that batch honest. Single-entry undo never calls validate.
    validate: (action, context) => restoreStateMatches(action) && batchMembersAreIndependent(action, context),
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
