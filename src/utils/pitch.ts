/**
 * Twelve-tone equal temperament: the shared A4 anchor and the MIDI note
 * number ↔ frequency conversion. Every tuner reading, pitch detector, CV
 * converter, and synth scheduler converts through here — a second restated
 * `440 * 2 ** ((note - 69) / 12)` is how two of them end up a cent apart.
 */

/** Concert-A reference frequency the 12-TET grid is anchored to. */
export const STANDARD_A4_HZ = 440;

/** MIDI note number of concert A (the A above middle C) on that grid. */
export const A4_MIDI_NOTE = 69;

/** Semitones per octave in twelve-tone equal temperament. */
export const SEMITONES_PER_OCTAVE = 12;

/**
 * Frequency of a MIDI note number on the 12-TET grid anchored at
 * {@link STANDARD_A4_HZ}: `midiNoteToFrequency(69) === 440`.
 */
export function midiNoteToFrequency(note: number): number {
    return STANDARD_A4_HZ * 2 ** ((note - A4_MIDI_NOTE) / SEMITONES_PER_OCTAVE);
}

/**
 * MIDI note number of a frequency on the same grid — fractional, because a
 * measured pitch rarely lands on a grid point. Inverse of
 * {@link midiNoteToFrequency}.
 */
export function frequencyToMidiNote(frequency: number): number {
    return A4_MIDI_NOTE + SEMITONES_PER_OCTAVE * Math.log2(frequency / STANDARD_A4_HZ);
}
