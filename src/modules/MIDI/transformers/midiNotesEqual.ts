import { type MidiNote } from '../models/MidiNote';

function midiNoteEqual(left: MidiNote, right: MidiNote): boolean {
    return (
        left.id === right.id &&
        left.pitch === right.pitch &&
        left.startBeat === right.startBeat &&
        left.duration === right.duration &&
        left.velocity === right.velocity &&
        left.probability === right.probability &&
        left.pressure === right.pressure &&
        left.slide === right.slide &&
        left.pitchBend === right.pitchBend &&
        left.pitchBendRangeSemitones === right.pitchBendRangeSemitones &&
        left.channel === right.channel
    );
}

export function midiNotesEqual(left: readonly MidiNote[], right: readonly MidiNote[]): boolean {
    return (
        left.length === right.length &&
        left.every((leftNote, index) => {
            const rightNote = right[index];
            return rightNote !== undefined && midiNoteEqual(leftNote, rightNote);
        })
    );
}
