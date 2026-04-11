import { cvGateStore } from '#/modules/Synth/stores/cvGate';

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
        return (note - 24) / 12;
    }
    return 440 * Math.pow(2, (note - 69) / 12);
}