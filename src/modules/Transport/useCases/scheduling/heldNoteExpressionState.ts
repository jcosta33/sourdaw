import { type startNoteExpression } from '#/modules/AudioEngine/useCases';

/**
 * The notes a scheduler window started and that are still sounding, so the expression moves of later
 * windows reach them: the note's own recorded curve points, and the track's channel pitch bend.
 *
 * A note posts its note-on and its release when it starts, and every later move of its expression is
 * posted by the scheduler window whose beat range contains it. A long note with a dense curve would
 * otherwise queue its whole life in one call, past what an engine's live queue holds, and a channel bend
 * struck, muted or edited after the note started would never reach it. A note's own curve points are
 * parked with it; the channel moves are not, because they belong to the clips as they stand when their
 * window plays: the window hands them over and each sounding note takes those that fall at its frames, on
 * the clock its release was placed on, so a move can never land on the other side of that release.
 *
 * Module state, because the scheduler that parks and the transport teardown that forgets are separate
 * use cases sharing one process-wide playback. Only notes this playback started are here: a note a seek
 * lands inside was never started, so nothing ever posts for it.
 */

export type HeldNote = {
    pitch: number;
    channel: number;
    /** The instrument that voiced the note: a different or bypassed one no longer holds it. */
    receiverId: string | undefined;
    /** The beat the note's release is posted at: past it the note is over and nothing addresses it. */
    releaseBeat: number;
    /** Whether the instrument sounds the track's channel bend, and so takes each move of it. */
    followsChannelBend: boolean;
    timeline: ReturnType<typeof startNoteExpression>['timeline'];
};

export const heldNotesByTrack = new Map<string, HeldNote[]>();
