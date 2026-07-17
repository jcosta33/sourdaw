/**
 * Scoring tuner state types.
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
    a4Reference: number;
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
    a4Reference: 440,
};
