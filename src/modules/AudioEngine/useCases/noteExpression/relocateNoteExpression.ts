import { findChannelBendInForce } from './findChannelBendInForce';
import {
    type ChannelBendPoint,
    type NoteExpressionTimeline,
    type ScheduledNoteExpression,
} from './noteExpressionTimeline';
import { readNoteExpression } from './readNoteExpression';

type RelocateNoteExpressionInput = {
    timeline: NoteExpressionTimeline;
    /** The track's whole channel bend, ordered by `frame` on the clock `atFrame` and `frameAtBeat` are on. */
    channelBend: readonly ChannelBendPoint[];
    /** The frame the relocated window opens on. */
    atFrame: number;
    /** The clock of the pass the note now sounds in, so a move of that pass is placed against its release. */
    frameAtBeat: (beat: number) => number;
};

function holdsSameBend(left: ScheduledNoteExpression, right: ScheduledNoteExpression): boolean {
    return left.pitchBend === right.pitchBend && left.pitchBendRangeSemitones === right.pitchBendRangeSemitones;
}

/** The channel bend the note holds at the destination: the one in force, else centre if a move had bent it. */
function resolveChannelAtDestination(
    timeline: NoteExpressionTimeline,
    inForce: ChannelBendPoint | undefined
): NoteExpressionTimeline['channel'] {
    if (inForce) {
        return { value: inForce.value, rangeSemitones: inForce.rangeSemitones };
    }
    if (!timeline.channel) {
        return undefined;
    }
    return { value: 0, rangeSemitones: timeline.channel.rangeSemitones };
}

/**
 * Carries a note that keeps sounding across a playback relocation (a scheduled loop seam) into the pass
 * it relocates to, and returns the expression to post when the bend in force there is not the one it holds.
 *
 * The bend in force at `atFrame` is the last channel move at or before it, and it takes the bend from the
 * note, as a channel move does; with none in force, a note a channel move bent returns to centre at the
 * depth it was bent at. The note's own curve points are not carried: they belong to the pass it left, and
 * would otherwise bend the note the next pass strikes on that pitch. The note's release stays on the frame
 * it was posted on, and its moves from now on are placed on the new clock.
 */
export function relocateNoteExpression({ timeline, channelBend, atFrame, frameAtBeat }: RelocateNoteExpressionInput): {
    timeline: NoteExpressionTimeline;
    expression: ScheduledNoteExpression | undefined;
} {
    const inForce = findChannelBendInForce(channelBend, atFrame);
    const channel = resolveChannelAtDestination(timeline, inForce);
    const relocated: NoteExpressionTimeline = {
        ...timeline,
        frameAtBeat,
        channel,
        bendOwner: channel ? 'channel' : timeline.bendOwner,
        // The move in force is the one the note has now taken, so the window's own listing of it is skipped.
        advancedBeat: inForce?.beat ?? Number.NEGATIVE_INFINITY,
        pending: [],
    };
    const expression = readNoteExpression(relocated);
    return {
        timeline: relocated,
        expression: holdsSameBend(readNoteExpression(timeline), expression) ? undefined : expression,
    };
}
