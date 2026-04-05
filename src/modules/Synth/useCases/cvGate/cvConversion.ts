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

/** Convert MIDI velocity (0-127) to CV voltage. Pure function. */
export function velocityToCv(velocity: number, maxVoltage: number = 5): number {
    return (velocity / 127) * maxVoltage;
}

/** Generate a clock signal value (square wave) at the given tempo and time. Pure function. */
export function getClockValue(bpm: number, timeSec: number, division: number = 1): number {
    const pulsePerSec = (bpm / 60) * division;
    const phase = (timeSec * pulsePerSec) % 1;
    return phase < 0.5 ? 1 : 0;
}
