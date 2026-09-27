import {
    MIDI_EXPRESSION_DIMENSIONS,
    type MidiExpressionPoint,
    type MidiNote,
    type MidiNoteExpression,
} from '../models/MidiNote';

export type MidiNoteExtentSlice = {
    /** Beats from the note's `startBeat` to the new start; negative extends the note earlier. */
    fromOffset: number;
    /** Length of the new span in beats. */
    duration: number;
};

type DimensionSlice = {
    scalar: number | undefined;
    curve: MidiExpressionPoint[];
};

function valueInEffectAt(
    scalar: number | undefined,
    curve: readonly MidiExpressionPoint[],
    offsetBeats: number
): number | undefined {
    let value = scalar;
    for (const point of curve) {
        if (point.offsetBeats > offsetBeats) {
            break;
        }
        value = point.value;
    }
    return value;
}

/**
 * The curve's points after `fromOffset` that fall strictly inside the new
 * span, re-based on `fromOffset`. Re-basing is a subtraction, which can round
 * two neighbours onto one offset; the later one wins, because it is the value
 * in effect from there on.
 */
function rebaseCurve(
    curve: readonly MidiExpressionPoint[],
    fromOffset: number,
    duration: number
): MidiExpressionPoint[] {
    const rebased: MidiExpressionPoint[] = [];
    for (const point of curve) {
        const offsetBeats = point.offsetBeats - fromOffset;
        if (point.offsetBeats <= fromOffset || offsetBeats <= 0 || offsetBeats >= duration) {
            continue;
        }
        const previous = rebased.at(-1);
        if (previous !== undefined && offsetBeats <= previous.offsetBeats) {
            rebased[rebased.length - 1] = { offsetBeats: previous.offsetBeats, value: point.value };
            continue;
        }
        rebased.push({ offsetBeats, value: point.value });
    }
    return rebased;
}

function sliceDimension(
    scalar: number | undefined,
    curve: readonly MidiExpressionPoint[] | undefined,
    { fromOffset, duration }: MidiNoteExtentSlice
): DimensionSlice {
    if (curve === undefined) {
        return { scalar, curve: [] };
    }
    return {
        scalar: valueInEffectAt(scalar, curve, fromOffset),
        curve: rebaseCurve(curve, fromOffset, duration),
    };
}

/**
 * The note re-cut to a new span of its own time: it starts `fromOffset` beats
 * after its `startBeat` and lasts `duration`, and its recorded expression stays
 * where it was performed.
 *
 * Each dimension's scalar becomes the value in effect at the new start (a point
 * at exactly that offset is folded into it); the curve keeps only the points
 * strictly inside the new span, re-based on the new start. A negative
 * `fromOffset` extends the note earlier: the note-on value then holds from the
 * new start and every point moves later by the extension. Every other field is
 * carried unchanged.
 */
export function sliceMidiNoteExtent(note: MidiNote, extent: MidiNoteExtentSlice): MidiNote {
    const { pressure, slide, pitchBend, expression, ...rest } = note;
    const sliced: MidiNote = {
        ...rest,
        startBeat: note.startBeat + extent.fromOffset,
        duration: extent.duration,
    };

    const scalars = { pressure, slide, pitchBend };
    const nextExpression: MidiNoteExpression = {};
    let hasCurve = false;
    for (const dimension of MIDI_EXPRESSION_DIMENSIONS) {
        const slice = sliceDimension(scalars[dimension], expression?.[dimension], extent);
        if (slice.scalar !== undefined) {
            sliced[dimension] = slice.scalar;
        }
        if (slice.curve.length > 0) {
            nextExpression[dimension] = slice.curve;
            hasCurve = true;
        }
    }
    if (hasCurve) {
        sliced.expression = nextExpression;
    }
    return sliced;
}
