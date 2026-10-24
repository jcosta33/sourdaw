import { clampScheduledExpression } from './clampScheduledExpression';
import { findChannelBendInForce } from './findChannelBendInForce';
import {
    type ChannelBendPoint,
    type NoteExpressionTimeline,
    type OwnExpressionMoment,
    type ScheduledNoteExpression,
} from './noteExpressionTimeline';
import { readNoteExpression } from './readNoteExpression';

/** One change of a recorded curve, `offsetBeats` after the note's start (local view of the MIDI model). */
type NoteExpressionCurvePoint = {
    offsetBeats: number;
    value: number;
};

type NoteExpressionCurves = {
    pressure?: readonly NoteExpressionCurvePoint[];
    slide?: readonly NoteExpressionCurvePoint[];
    pitchBend?: readonly NoteExpressionCurvePoint[];
};

/** A note's expression as project truth stores it: the scalars in force at note-on and the curves after it. */
type NoteExpressionCurveSource = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
    /**
     * The zero-based MIDI channel the note was recorded on. Absent for a note that stores none, which hears the
     * channel moves of every channel, as it did before notes kept their channel.
     */
    channel?: number;
    expression?: NoteExpressionCurves;
};

type StartNoteExpressionInput = {
    note: NoteExpressionCurveSource;
    /**
     * The track's channel pitch bend, ordered by `frame` (posting order); only the move in force at the
     * note's start frame that reaches the note's channel is read. A note whose own scalar or curve holds no
     * bend by then starts under it.
     */
    channelBend?: readonly ChannelBendPoint[];
    /** Where the caller plays the note from: grooved, looped and offset, so a curve moves with its note. */
    startBeat: number;
    /**
     * How far into the note `startBeat` is when a clip trim or a loop pass cut its head off (the tail of a
     * note that wraps a loop seam starts a part of the way through it). The curve is measured from the
     * note's uncut start, `startBeat - beatsIntoNote`. Absent when the note plays from its start.
     */
    beatsIntoNote?: number;
    /** The frame the note's release is posted on; nothing at or after it is projected. */
    releaseFrame: number;
    /** The caller's beat-to-frame conversion, the same one that places the note's own start and release. */
    frameAtBeat: (beat: number) => number;
    /**
     * The clock `channelBend` frames are on, when it differs from `frameAtBeat` by not clamping a beat before
     * the render region's start. The note's own bend and the channel move are compared on it, by where each
     * was recorded, because the clamp would put a note's earlier bend on the same frame as a later move.
     * Defaults to `frameAtBeat`.
     */
    channelBendFrameAtBeat?: (beat: number) => number;
};

type ExpressionReader = (offsetBeats: number) => number | undefined;

/** The step-held value of one dimension: the last point at or before an offset, else the scalar. */
function createExpressionReader(
    scalar: number | undefined,
    curve: readonly NoteExpressionCurvePoint[]
): ExpressionReader {
    let nextIndex = 0;
    let value = scalar;
    return (offsetBeats) => {
        while (nextIndex < curve.length && curve[nextIndex]!.offsetBeats <= offsetBeats) {
            value = curve[nextIndex]!.value;
            nextIndex++;
        }
        return value;
    };
}

function listCurveOffsets(curves: NoteExpressionCurves): number[] {
    const offsets = new Set<number>();
    for (const curve of [curves.pressure, curves.slide, curves.pitchBend]) {
        for (const point of curve ?? []) {
            offsets.add(point.offsetBeats);
        }
    }
    return [...offsets].sort((left, right) => left - right);
}

type ListOwnMomentsInput = Pick<StartNoteExpressionInput, 'note' | 'releaseFrame' | 'frameAtBeat'> & {
    /** Where the note began before any cut, which the curve offsets count from. */
    noteStartBeat: number;
};

/** Where the note's own curves move before its release, in time order, each with the full expression in force. */
function listOwnMoments({
    note,
    noteStartBeat,
    releaseFrame,
    frameAtBeat,
}: ListOwnMomentsInput): OwnExpressionMoment[] {
    const curves = note.expression;
    if (!curves) {
        return [];
    }
    const readPressure = createExpressionReader(note.pressure, curves.pressure ?? []);
    const readSlide = createExpressionReader(note.slide, curves.slide ?? []);
    const readPitchBend = createExpressionReader(note.pitchBend, curves.pitchBend ?? []);
    const bendOffsets = new Set((curves.pitchBend ?? []).map((point) => point.offsetBeats));
    const moments: OwnExpressionMoment[] = [];
    for (const offsetBeats of listCurveOffsets(curves)) {
        const beat = noteStartBeat + offsetBeats;
        const frame = frameAtBeat(beat);
        if (frame >= releaseFrame) {
            break;
        }
        moments.push({
            beat,
            frame,
            expression: clampScheduledExpression(
                {
                    pressure: readPressure(offsetBeats),
                    slide: readSlide(offsetBeats),
                    pitchBend: readPitchBend(offsetBeats),
                },
                note.pitchBendRangeSemitones
            ),
            claimsBend: bendOffsets.has(offsetBeats),
        });
    }
    return moments;
}

type FindOwnBendFrameInput = {
    scalarBend: number | undefined;
    /** The note's own moments at or before the start frame, in time order. */
    passedMoments: readonly OwnExpressionMoment[];
    /** Where the note began before any cut, where its scalar bend took hold. */
    noteStartBeat: number;
    /** The clock the note's own bend is compared with the channel move on. */
    frameAtBeat: (beat: number) => number;
};

/**
 * Where the note's own bend was last set at or before its start: its last bend point, else its scalar at
 * the uncut note start. Undefined when the note holds no bend, which leaves it to the channel.
 */
function findOwnBendFrame({
    scalarBend,
    passedMoments,
    noteStartBeat,
    frameAtBeat,
}: FindOwnBendFrameInput): number | undefined {
    const lastBendMoment = passedMoments.findLast((moment) => moment.claimsBend);
    if (lastBendMoment) {
        return frameAtBeat(lastBendMoment.beat);
    }
    return scalarBend === undefined ? undefined : frameAtBeat(noteStartBeat);
}

/**
 * Starts a note's expression: what its note-on carries and the timeline that moves it on.
 *
 * The note-on carries `atStart` when a curve point lands on or before the start frame (the points a cut
 * passed fold into it) or when a channel bend stands in for a bend the note does not hold. It is absent
 * when the note's scalars govern, so the caller posts them as they are.
 *
 * At the start the later of the note's own last bend and the channel move in force there holds the bend,
 * by frame: the note's last bend point at or before the start, else its scalar counted at the uncut note
 * start (a performer's note-on carries its own bend, so an earlier channel move leaves it alone, while a
 * move recorded after it, before a cut head, is in force). The move counts where it was recorded
 * (`recordedBeat`), not where it plays: a trimmed clip head carries its rows onto the head the cut note
 * starts on, though they may precede the note's own bend. A tie on one frame stays with the note. A note
 * with no bend sounds under the channel bend in force, the last move at or before the start frame that
 * reaches it: one recorded on its channel, or any move that is not channel-scoped. From then on the later event wins
 * (`advanceNoteExpression`).
 */
export function startNoteExpression({
    note,
    channelBend = [],
    startBeat,
    beatsIntoNote = 0,
    releaseFrame,
    frameAtBeat,
    channelBendFrameAtBeat = frameAtBeat,
}: StartNoteExpressionInput): { atStart: ScheduledNoteExpression | undefined; timeline: NoteExpressionTimeline } {
    const startFrame = frameAtBeat(startBeat);
    const moments = listOwnMoments({ note, noteStartBeat: startBeat - beatsIntoNote, releaseFrame, frameAtBeat });
    const firstAfterStart = moments.findIndex((moment) => moment.frame > startFrame);
    const passedCount = firstAfterStart === -1 ? moments.length : firstAfterStart;
    const own =
        moments[passedCount - 1]?.expression ??
        clampScheduledExpression(
            { pressure: note.pressure, slide: note.slide, pitchBend: note.pitchBend },
            note.pitchBendRangeSemitones
        );
    const noteChannel = note.channel;
    const inForce = findChannelBendInForce(channelBend, startFrame, noteChannel);
    const channel = inForce && { value: inForce.value, rangeSemitones: inForce.rangeSemitones };
    const ownBendFrame = findOwnBendFrame({
        scalarBend: note.pitchBend,
        passedMoments: moments.slice(0, passedCount),
        noteStartBeat: startBeat - beatsIntoNote,
        frameAtBeat: channelBendFrameAtBeat,
    });
    const channelBentLast =
        inForce !== undefined &&
        (ownBendFrame === undefined || channelBendFrameAtBeat(inForce.recordedBeat) > ownBendFrame);
    const bendOwner = channelBentLast ? 'channel' : 'note';
    const timeline: NoteExpressionTimeline = {
        noteChannel,
        startFrame,
        releaseFrame,
        frameAtBeat,
        own,
        channel,
        bendOwner,
        advancedBeat: Number.NEGATIVE_INFINITY,
        pending: moments.slice(passedCount),
    };
    return {
        atStart: passedCount > 0 || bendOwner === 'channel' ? readNoteExpression(timeline) : undefined,
        timeline,
    };
}
