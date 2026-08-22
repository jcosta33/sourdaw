/**
 * Per-note physical parameter overrides for the Grand Boule piano.
 *
 * Each key (1–88) may carry up to 8 multiplier parameters that deviate from
 * the global voicing curve. All values are multipliers where 1.0 = neutral
 * (follow global preset). The engine receives them via the naming convention
 * `perNote.{key}.{param}`.
 */

import { NOTE_NAMES } from '#/utils/noteNames';

/** Descriptor for a single per-note parameter (metadata for UI). */
export type PerNoteParamDescriptor = {
    readonly key: keyof GrandBoulePerNoteValues;
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly defaultValue: number;
    readonly step: number;
    readonly unit: string;
};

/** The adjustable per-note parameter values. */
export type GrandBoulePerNoteValues = {
    /** Multiplier on hammer stiffness K. */
    hammerHardness: number;
    /** Multiplier on hammer mass. */
    hammerMass: number;
    /** Multiplier on inharmonicity B. */
    stringStiffness: number;
    /** Per-note bridge contribution (0 = disconnected). */
    bridgeCoupling: number;
    /** Damper bandwidth multiplier. */
    damperFirmness: number;
    /** Per-note sympathetic contribution. */
    sympatheticGain: number;
    /** Multiplier on hammer strike ratio. */
    strikePosition: number;
    /** Partial amplitude tilt (1.0 = neutral). */
    toneBrightness: number;
};

/** Full per-note map: key number (1–88) to parameter values. */
export type GrandBoulePerNoteMap = Map<number, GrandBoulePerNoteValues>;

export const PER_NOTE_PARAM_DESCRIPTORS: readonly PerNoteParamDescriptor[] = [
    { key: 'hammerHardness', label: 'Hammer', min: 0.5, max: 2.0, defaultValue: 1.0, step: 0.01, unit: '×' },
    { key: 'hammerMass', label: 'Mass', min: 0.5, max: 2.0, defaultValue: 1.0, step: 0.01, unit: '×' },
    { key: 'stringStiffness', label: 'Stiffness', min: 0.5, max: 2.0, defaultValue: 1.0, step: 0.01, unit: '×' },
    { key: 'bridgeCoupling', label: 'Bridge', min: 0.0, max: 2.0, defaultValue: 1.0, step: 0.01, unit: '×' },
    { key: 'damperFirmness', label: 'Damper', min: 0.5, max: 2.0, defaultValue: 1.0, step: 0.01, unit: '×' },
    { key: 'sympatheticGain', label: 'Sympath', min: 0.0, max: 2.0, defaultValue: 1.0, step: 0.01, unit: '×' },
    { key: 'strikePosition', label: 'Strike', min: 0.5, max: 1.5, defaultValue: 1.0, step: 0.01, unit: '×' },
    { key: 'toneBrightness', label: 'Bright', min: 0.5, max: 2.0, defaultValue: 1.0, step: 0.01, unit: '×' },
] as const;

export function createDefaultPerNoteValues(): GrandBoulePerNoteValues {
    return {
        hammerHardness: 1.0,
        hammerMass: 1.0,
        stringStiffness: 1.0,
        bridgeCoupling: 1.0,
        damperFirmness: 1.0,
        sympatheticGain: 1.0,
        strikePosition: 1.0,
        toneBrightness: 1.0,
    };
}

/** Convert a MIDI note (21–108) to a piano key number (1–88). */
export function midiNoteToKey(midiNote: number): number {
    return midiNote - 20;
}

/** Convert a piano key number (1–88) to a MIDI note (21–108). */
export function keyToMidiNote(key: number): number {
    return key + 20;
}

/**
 * Build the note name for display (e.g. "A0", "C4", "C8").
 * Key 1 = A0 (MIDI 21), Key 88 = C8 (MIDI 108).
 */
export function keyToNoteName(key: number): string {
    const midiNote = keyToMidiNote(key);
    const name = NOTE_NAMES[midiNote % 12];
    const octave = Math.floor(midiNote / 12) - 1;
    return `${name}${octave}`;
}
