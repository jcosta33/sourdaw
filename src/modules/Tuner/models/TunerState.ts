/**
 * Tuner state types.
 *
 * Everything here is either telemetry pushed *out* of the analyser or the
 * display-mode preference, which is pure panel chrome. The concert-A reference
 * is deliberately absent: it is an input to the DSP, so it lives on
 * `Device.parameterValues` as `a4_hz` (see `models/A4Reference.ts`). Mirroring
 * it here as well gave the panel a second copy that the engine never read and
 * the project-open reset cleared, which is how the reference knob came to move
 * a number on screen and nothing else.
 */

export type DisplayMode = 'needle' | 'strobe' | 'poly';

export type TunerState = {
    frequency: number;
    cents: number;
    confidence: number;
    noteIndex: number;
    octave: number;
    midiNote: number;
    noteName: string;
    active: boolean;
    mode: DisplayMode;
};

export const DEFAULT_TUNER_STATE: TunerState = {
    frequency: 0,
    cents: 0,
    confidence: 0,
    noteIndex: 9, // A
    octave: 4,
    midiNote: 69,
    noteName: 'A',
    active: false,
    mode: 'needle',
};
