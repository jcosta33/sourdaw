import {
    MIDI_EXPRESSION_DIMENSIONS,
    type MidiExpressionDimension,
    type MidiNote,
    type MidiNoteExpression,
} from '../../models/MidiNote';
import { type ActiveNoteData } from '../../models/WebMidiTypes';
import { sliceMidiNoteExtent } from '../../services/sliceMidiNoteExtent';

function normalizeRecordedPitchBend(
    noteData: ActiveNoteData,
    scalars: Pick<MidiNote, MidiExpressionDimension>,
    expression: MidiNoteExpression,
    secondsToBeats: (seconds: number) => number
): number {
    const bendTrail = noteData.expressionTrails?.pitchBend;
    const bendRanges = [noteData.pitchBendRangeSemitones ?? 48];
    if (bendTrail?.initial !== undefined) {
        bendRanges.push(bendTrail.initialBendRangeSemitones ?? 48);
    }
    for (const point of bendTrail?.points ?? []) {
        bendRanges.push(point.bendRangeSemitones ?? 48);
    }
    const storedBendRange = Math.max(...bendRanges);
    const normalizeBend = (value: number, range: number): number =>
        storedBendRange === 0 ? 0 : (value * range) / storedBendRange;
    if (scalars.pitchBend !== undefined) {
        scalars.pitchBend = normalizeBend(
            scalars.pitchBend,
            bendTrail?.initialBendRangeSemitones ?? noteData.pitchBendRangeSemitones ?? 48
        );
    }
    if (bendTrail !== undefined) {
        expression.pitchBend = bendTrail.points.map((point) => ({
            offsetBeats: secondsToBeats(point.offsetSeconds),
            value: normalizeBend(point.value, point.bendRangeSemitones ?? 48),
        }));
    }
    return storedBendRange;
}

/**
 * The recorded note carrying the held note's MPE expression: each scalar is
 * the value in effect at note-on, and each dimension's changes after note-on
 * become a curve with offsets converted by `secondsToBeats`, the conversion the
 * note's duration used. Points at or beyond the note's duration are dropped and
 * a point at offset 0 folds into the scalar. The bend range is stored whenever
 * the note carries a bend, as a scalar or as a curve.
 */
export function withRecordedNoteExpression(
    midiNote: MidiNote,
    noteData: ActiveNoteData,
    secondsToBeats: (seconds: number) => number
): MidiNote {
    const scalars: Pick<MidiNote, MidiExpressionDimension> = {};
    const expression: MidiNoteExpression = {};
    for (const dimension of MIDI_EXPRESSION_DIMENSIONS) {
        const trail = noteData.expressionTrails?.[dimension];
        const scalar = trail === undefined ? noteData[dimension] : trail.initial;
        if (scalar !== undefined) {
            scalars[dimension] = scalar;
        }
        if (trail !== undefined) {
            expression[dimension] = trail.points.map((point) => ({
                offsetBeats: secondsToBeats(point.offsetSeconds),
                value: point.value,
            }));
        }
    }
    const storedBendRange = normalizeRecordedPitchBend(noteData, scalars, expression, secondsToBeats);
    const sliced = sliceMidiNoteExtent(
        { ...midiNote, ...scalars, expression },
        { fromOffset: 0, duration: midiNote.duration }
    );
    if (sliced.pitchBend === undefined && sliced.expression?.pitchBend === undefined) {
        return sliced;
    }
    // Persist the depth alongside the wire delta. Without it playback
    // re-interprets every recorded bend at the MPE default, so a
    // controller set to ±12 records +6 semitones and plays back +24.
    return { ...sliced, pitchBendRangeSemitones: storedBendRange };
}
