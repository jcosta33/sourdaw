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

/**
 * One string of the polyphonic tracker's reading, low string first (E2 first
 * for the guitar set the panel labels). Mirrors the worklet's per-string
 * telemetry structurally; the sink registration in the composition root is
 * what keeps the two shapes assignable.
 */
export type TunerPolyStringState = {
    active: boolean;
    cents: number;
    confidence: number;
};

/** Shared empty reading so the default state never mints a fresh array. */
const EMPTY_POLY_STRINGS: readonly TunerPolyStringState[] = Object.freeze([]);

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
    scaleName?: string;
    /** Per-string poly readings; empty while the poly tracker is off or bypassed. */
    polyStrings: readonly TunerPolyStringState[];
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
    polyStrings: EMPTY_POLY_STRINGS,
};
