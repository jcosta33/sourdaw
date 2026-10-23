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
    expression?: NoteExpressionCurves;
};

type StartNoteExpressionInput = {
    note: NoteExpressionCurveSource;
    /**
     * The track's channel pitch bend, ordered by `frame` (posting order); only the move in force at the
     * note's start frame is read. A note whose own scalar or curve holds no bend by then starts under it.
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

/**
 * Starts a note's expression: what its note-on carries and the timeline that moves it on.
 *
 * The note-on carries `atStart` when a curve point lands on or before the start frame (the points a cut
 * passed fold into it) or when a channel bend stands in for a bend the note does not hold. It is absent
 * when the note's scalars govern, so the caller posts them as they are.
 *
 * At the start the note's own bend wins when it holds one (its scalar, or a curve point at or before the
 * start), as a performer's note-on carries its own bend; only a note with none sounds under the channel
 * bend in force there, the last move at or before the start frame. From then on the later event wins
 * (`advanceNoteExpression`).
 */
export function startNoteExpression({
    note,
    channelBend = [],
    startBeat,
    beatsIntoNote = 0,
    releaseFrame,
    frameAtBeat,
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
    const inForce = findChannelBendInForce(channelBend, startFrame);
    const channel = inForce && { value: inForce.value, rangeSemitones: inForce.rangeSemitones };
    const bendOwner = own.pitchBend === undefined && channel ? 'channel' : 'note';
    const timeline: NoteExpressionTimeline = {
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
