import { isValidMidiNoteExpression, MIDI_EXPRESSION_DIMENSIONS, type MidiNoteExpression } from '../models/MidiNote';

/** Keep an admitted performance independent of the caller's mutable curves. */
export function cloneMidiNoteForAdmission<TNote extends { duration: number; expression?: MidiNoteExpression }>(
    note: TNote
): TNote {
    if (!isValidMidiNoteExpression(note.expression, note.duration)) {
        return note;
    }

    const expression: MidiNoteExpression = {};
    for (const dimension of MIDI_EXPRESSION_DIMENSIONS) {
        const curve = note.expression[dimension];
        if (curve) {
            expression[dimension] = curve.map((point) => ({ offsetBeats: point.offsetBeats, value: point.value }));
        }
    }
    return { ...note, expression };
}
