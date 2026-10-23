/** The full expression in force at one moment, in wire units, clamped to their ranges. */
export type ScheduledNoteExpression = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /** Present exactly when `pitchBend` is, so a range never describes a bend that does not exist. */
    pitchBendRangeSemitones?: number;
};

/**
 * One move of the track's channel pitch bend (the MIDI module's `projectChannelBend`), on the
 * caller's own clock: the same `frame` its notes are placed on.
 */
export type ChannelBendPoint = {
    beat: number;
    frame: number;
    /**
     * Where the move was recorded, on the timeline of the pass that plays it: `beat`, except for a move a pass
     * head carries from before it (a trimmed-off clip head's row), which was recorded earlier than it plays.
     */
    recordedBeat: number;
    /** Signed 14-bit wire delta, -8192..8191. */
    value: number;
    /** The depth `value` is read against, in semitones. */
    rangeSemitones: number;
};

export type ProjectedNoteExpressionChange = {
    /** Absolute beat of the change, the note's start plus the curve offset. */
    beat: number;
    /** Where the caller's clock places `beat`; one change per frame. */
    frame: number;
    expression: ScheduledNoteExpression;
};

/** A moment the note's own curves move, with the full expression in force from it. */
export type OwnExpressionMoment = ProjectedNoteExpressionChange & {
    /**
     * Whether a point of the note's own pitch-bend curve lands here. Only such a moment takes the bend back
     * from a channel move; a pressure or slide point leaves the bend where it stands.
     */
    claimsBend: boolean;
};

type ChannelBendInForce = { value: number; rangeSemitones: number };

/**
 * A started note's expression as it moves on: what its own curves and scalars say, the track's channel
 * bend last seen, and which of the two set the bend most recently. Consumed window by window, so a bend
 * move the clips hold now reaches a note whichever window started it.
 */
export type NoteExpressionTimeline = {
    /** The frame the note starts on; a channel move at or before it is the note-on's own business. */
    startFrame: number;
    /** The frame the note's release is posted on; nothing at or after it is addressed to the voice. */
    releaseFrame: number;
    /** The clock the note was placed on, which every later move of the note is placed on too. */
    frameAtBeat: (beat: number) => number;
    /** What the note's own curves and scalars put in force. */
    own: ScheduledNoteExpression;
    channel: ChannelBendInForce | undefined;
    /** Whoever moved the bend last wins it: the note's own point or a channel move. */
    bendOwner: 'note' | 'channel';
    /**
     * The beat of the latest event, own or channel, the timeline has taken. A channel move at or before it
     * is one the note has already followed (or one an own point after it has overtaken), so a window that
     * lists the moves again, as the one resuming after a mute does, never replays it.
     */
    advancedBeat: number;
    /** The note's own moments not yet taken, in time order. */
    pending: readonly OwnExpressionMoment[];
};
