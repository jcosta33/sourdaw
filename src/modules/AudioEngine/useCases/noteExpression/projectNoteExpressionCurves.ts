import { advanceNoteExpression } from './advanceNoteExpression';
import { startNoteExpression } from './startNoteExpression';

type ProjectNoteExpressionCurvesInput = Parameters<typeof startNoteExpression>[0];

type ProjectedNoteExpressionCurves = {
    /**
     * The expression in force at the note's start frame when a curve point lands on or before it or a
     * channel bend stands in for the note's own, so the note-on carries it instead of the scalars.
     */
    atStart?: ReturnType<typeof startNoteExpression>['atStart'];
    /** Changes strictly after the start frame and strictly before the release frame, in time order. */
    changes: ReturnType<typeof advanceNoteExpression>['changes'];
};

/**
 * The changes a note's recorded expression curves and the track's channel pitch bend make after its
 * note-on, over the whole timeline: the offline render's projection, and the one live scheduling plays
 * window by window (`startNoteExpression`, `advanceNoteExpression`), so a pressure swell or a bend replays
 * as performed in both.
 *
 * There is one change per distinct moment the expression moves, each carrying the full expression in force
 * for all three dimensions (each dimension's last point at or before the offset, else its scalar), because
 * the engines read a missing dimension as neutral and would otherwise reset a bend the note still holds.
 * The moment is the frame the caller's own clock gives the note's start beat plus the offset, so a curve
 * keeps its place in the note under a tempo map, a groove, a loop pass or a clip offset. When a cut took the
 * head off the note (`beatsIntoNote`), offsets still count from where the note began, so the points the cut
 * passed fold into `atStart` and the rest keep their absolute positions, as `sliceMidiNoteExtent` re-cuts them.
 *
 * A change at or past `releaseFrame` is dropped: the model keeps every point inside the note, but a loop or
 * clip cut can shorten the note, and expression for a voice that has been released addresses nothing. A
 * change that lands on the start frame replaces the note-on's expression (`atStart`), and changes that share
 * a later frame collapse to the last, so no frame receives two.
 *
 * The track's channel bend (`channelBend`) adds the moves of its own. At the start the later of the note's
 * own last bend and the channel move in force there holds the bend (`startNoteExpression`); after it, whichever of a channel
 * move and the note's own bend point comes later holds the bend and its range, and the note's pressure and
 * slide stay its own, because an engine takes the three together. A move on the release frame is dropped with
 * the voice, and one on the start frame is the note-on's own expression, so a bend struck with a note sounds
 * under it from its first sample.
 */
export function projectNoteExpressionCurves(input: ProjectNoteExpressionCurvesInput): ProjectedNoteExpressionCurves {
    const { atStart, timeline } = startNoteExpression(input);
    const { changes } = advanceNoteExpression({
        timeline,
        fromBeat: Number.NEGATIVE_INFINITY,
        toBeat: Number.POSITIVE_INFINITY,
        fromFrame: Number.NEGATIVE_INFINITY,
        channelMoves: input.channelBend ?? [],
    });
    return { atStart, changes };
}
