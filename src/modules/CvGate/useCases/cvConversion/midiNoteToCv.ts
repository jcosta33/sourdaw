import { midiNoteToFrequency, SEMITONES_PER_OCTAVE } from '#/utils/pitch';

import { cvGateStore } from '../../stores/cvGate';

/** The 1V/octave law's zero-volt anchor: C0, MIDI note 24, sits at 0V. */
const CV_ONE_VOLT_PER_OCTAVE_C0_MIDI = 24;

/**
 * Convert a MIDI note number to CV voltage.
 * 1V/oct: C0 (MIDI 24) = 0V, each octave = 1V.
 * Hz/V: frequency doubles per octave from A4 = 440Hz.
 */
export function midiNoteToCv(note: number): number {
    const state = cvGateStore.value;
    if (!state) {
        return 0;
    }
    if (state.voltageStandard === '1v-per-octave') {
        return (note - CV_ONE_VOLT_PER_OCTAVE_C0_MIDI) / SEMITONES_PER_OCTAVE;
    }
    return midiNoteToFrequency(note);
}
