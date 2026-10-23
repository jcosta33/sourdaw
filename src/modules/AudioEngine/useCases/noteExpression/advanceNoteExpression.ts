import {
    type ChannelBendPoint,
    type NoteExpressionTimeline,
    type OwnExpressionMoment,
    type ProjectedNoteExpressionChange,
} from './noteExpressionTimeline';
import { readNoteExpression } from './readNoteExpression';

type AdvanceNoteExpressionInput = {
    timeline: NoteExpressionTimeline;
    /** Where the window opens. An event before it fell in a window that did not run for the note. */
    fromBeat: number;
    /** Where the window closes: an event at or past it waits for a later window. */
    toBeat: number;
    /** The frame `fromBeat` is placed on, where the expression in force when the window opens is posted. */
    fromFrame: number;
    /**
     * The channel bend moves to take, in posting order. The caller reads them from the clips as they are
     * now, over the window; those before `fromBeat` are the ones a muted span kept from the instrument.
     */
    channelMoves: readonly ChannelBendPoint[];
};

type ExpressionEvent =
    | { kind: 'channel'; beat: number; frame: number; move: ChannelBendPoint }
    | { kind: 'own'; beat: number; frame: number; moment: OwnExpressionMoment };

function followOwnMoment(timeline: NoteExpressionTimeline, moment: OwnExpressionMoment): NoteExpressionTimeline {
    return {
        ...timeline,
        own: moment.expression,
        bendOwner: moment.claimsBend ? 'note' : timeline.bendOwner,
    };
}

function followChannelMove(timeline: NoteExpressionTimeline, move: ChannelBendPoint): NoteExpressionTimeline {
    return {
        ...timeline,
        channel: { value: move.value, rangeSemitones: move.rangeSemitones },
        bendOwner: 'channel',
    };
}

function listChannelEvents(
    timeline: NoteExpressionTimeline,
    channelMoves: readonly ChannelBendPoint[],
    toBeat: number
): ExpressionEvent[] {
    return channelMoves.flatMap((move) => {
        if (move.beat >= toBeat) {
            return [];
        }
        const frame = timeline.frameAtBeat(move.beat);
        // A move at or before the start frame is the note-on's own business; one at the release is dropped with the voice.
        if (frame <= timeline.startFrame || frame >= timeline.releaseFrame) {
            return [];
        }
        return [{ kind: 'channel' as const, beat: move.beat, frame, move }];
    });
}

/**
 * Moves a started note's expression on through one scheduler window and returns the changes to post.
 *
 * The note's own curve points before `toBeat` and the channel moves given meet in time order, and each
 * leaves the full expression in force, because an engine reads a missing dimension as neutral. The later
 * event wins the bend and its range: a channel move holds it until the note's next own bend point, and
 * that point holds it until the next channel move. A pressure or slide point never takes the bend back.
 * Events that share a frame collapse to the last.
 *
 * Events before `fromBeat` fell in windows that did not run for the note, so they are never posted at
 * their own, passed, frame; the instrument was told nothing of them, so the last is posted once at
 * `fromFrame`, ahead of the window's own changes. The caller does not ask for a note already released.
 *
 * Channel moves come with the window, not the note: a move the clips hold now reaches every note that
 * sounds on the track at its frame, on the note's own clock.
 */
export function advanceNoteExpression({
    timeline,
    fromBeat,
    toBeat,
    fromFrame,
    channelMoves,
}: AdvanceNoteExpressionInput): { timeline: NoteExpressionTimeline; changes: ProjectedNoteExpressionChange[] } {
    const dueCount = timeline.pending.findIndex((moment) => moment.beat >= toBeat);
    const taken = dueCount === -1 ? timeline.pending.length : dueCount;
    // The sort is stable and the channel moves are listed first, so at one frame the note's own point has the
    // last word, as it has at the note's start.
    const events: ExpressionEvent[] = [
        ...listChannelEvents(timeline, channelMoves, toBeat),
        ...timeline.pending
            .slice(0, taken)
            .map((moment): ExpressionEvent => ({ kind: 'own', beat: moment.beat, frame: moment.frame, moment })),
    ].sort((left, right) => left.frame - right.frame);

    let advanced: NoteExpressionTimeline = { ...timeline, pending: timeline.pending.slice(taken) };
    let chase: ProjectedNoteExpressionChange | undefined;
    const changes: ProjectedNoteExpressionChange[] = [];
    for (const event of events) {
        advanced =
            event.kind === 'own' ? followOwnMoment(advanced, event.moment) : followChannelMove(advanced, event.move);
        const change = { beat: event.beat, frame: event.frame, expression: readNoteExpression(advanced) };
        if (event.beat < fromBeat) {
            chase = { ...change, beat: fromBeat, frame: fromFrame };
        } else if (changes.at(-1)?.frame === event.frame) {
            changes[changes.length - 1] = change;
        } else {
            changes.push(change);
        }
    }
    return { timeline: advanced, changes: chase ? [chase, ...changes] : changes };
}
