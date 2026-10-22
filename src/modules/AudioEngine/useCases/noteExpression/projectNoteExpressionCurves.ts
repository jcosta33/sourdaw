import { MAX_MIDI_DATA_7BIT, PITCH_BEND_MAX, PITCH_BEND_MIN } from '#/utils/midiData';

import { getDefaultBendRangeSemitones } from './getDefaultBendRangeSemitones';

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

/** The full expression in force at one moment, in wire units, clamped to their ranges. */
type ScheduledNoteExpression = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /** Present exactly when `pitchBend` is, so a range never describes a bend that does not exist. */
    pitchBendRangeSemitones?: number;
};

type ProjectedNoteExpressionChange = {
    /** Absolute beat of the change, the note's start plus the curve offset. */
    beat: number;
    /** Where the caller's clock places `beat`; one change per frame. */
    frame: number;
    expression: ScheduledNoteExpression;
};

type ProjectedNoteExpressionCurves = {
    /**
     * The expression in force at the note's start frame when a curve point lands on or before it, so the
     * note-on's own expression carries that point instead of the scalar. Absent when the scalar governs.
     */
    atStart?: ScheduledNoteExpression;
    /** Changes strictly after the start frame and strictly before the release frame, in time order. */
    changes: ProjectedNoteExpressionChange[];
};

type ProjectNoteExpressionCurvesInput = {
    note: NoteExpressionCurveSource;
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

function clampOptional(value: number | undefined, minimum: number, maximum: number): number | undefined {
    return value === undefined ? undefined : Math.min(maximum, Math.max(minimum, value));
}

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

function clampScheduledExpression(
    values: { pressure?: number; slide?: number; pitchBend?: number },
    recordedRangeSemitones: number | undefined
): ScheduledNoteExpression {
    const expression: ScheduledNoteExpression = {
        pressure: clampOptional(values.pressure, 0, MAX_MIDI_DATA_7BIT),
        slide: clampOptional(values.slide, 0, MAX_MIDI_DATA_7BIT),
        pitchBend: clampOptional(values.pitchBend, PITCH_BEND_MIN, PITCH_BEND_MAX),
    };
    if (values.pitchBend !== undefined) {
        expression.pitchBendRangeSemitones = clampOptional(
            recordedRangeSemitones ?? getDefaultBendRangeSemitones(),
            0,
            127
        );
    }
    return expression;
}

/**
 * The changes a note's recorded expression curves make after its note-on, for live scheduling and the
 * offline render alike, so a pressure swell or a bend replays as performed in both.
 *
 * There is one change per distinct moment a curve moves, each carrying the full expression in force at it
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
 */
export function projectNoteExpressionCurves({
    note,
    startBeat,
    beatsIntoNote = 0,
    releaseFrame,
    frameAtBeat,
}: ProjectNoteExpressionCurvesInput): ProjectedNoteExpressionCurves {
    const curves = note.expression;
    if (!curves) {
        return { changes: [] };
    }

    const noteStartBeat = startBeat - beatsIntoNote;
    const startFrame = frameAtBeat(startBeat);
    const readPressure = createExpressionReader(note.pressure, curves.pressure ?? []);
    const readSlide = createExpressionReader(note.slide, curves.slide ?? []);
    const readPitchBend = createExpressionReader(note.pitchBend, curves.pitchBend ?? []);

    let atStart: ScheduledNoteExpression | undefined;
    const changes: ProjectedNoteExpressionChange[] = [];
    for (const offsetBeats of listCurveOffsets(curves)) {
        const beat = noteStartBeat + offsetBeats;
        const frame = frameAtBeat(beat);
        if (frame >= releaseFrame) {
            break;
        }
        const expression = clampScheduledExpression(
            {
                pressure: readPressure(offsetBeats),
                slide: readSlide(offsetBeats),
                pitchBend: readPitchBend(offsetBeats),
            },
            note.pitchBendRangeSemitones
        );
        if (frame <= startFrame) {
            atStart = expression;
        } else if (changes.at(-1)?.frame === frame) {
            changes[changes.length - 1] = { beat, frame, expression };
        } else {
            changes.push({ beat, frame, expression });
        }
    }

    return { atStart, changes };
}
