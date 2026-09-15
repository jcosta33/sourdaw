/**
 * MIDI data-value law: the 7-bit ceiling every data byte (velocity, pressure,
 * slide) obeys, and the 14-bit span a pitch-bend or high-resolution pair
 * encodes. Named once because live scheduling, offline rendering, and the MIDI
 * module all convert through these — a restated `127` or `8192` at a
 * conversion site is how one path drifts from the others.
 */

/**
 * Ceiling of a single 7-bit MIDI data value — velocity, channel pressure,
 * per-note pressure, slide. The wire format carries seven bits, so a value
 * above this cannot be transmitted at all.
 */
export const MAX_MIDI_DATA_7BIT = 127;

/** Clamp a MIDI data value into the 0…{@link MAX_MIDI_DATA_7BIT} wire range. */
export function clampMidiData7(value: number): number {
    return Math.max(0, Math.min(MAX_MIDI_DATA_7BIT, value));
}

/**
 * Lowest velocity that still sounds. MIDI 1.0 gives velocity 0 the note-off
 * meaning, so 1 is the quietest strike a voice can receive.
 */
export const MIN_AUDIBLE_VELOCITY = 1;

/**
 * Full-scale value of a 14-bit high-resolution controller or bend pair
 * (`MSB << 7 | LSB`): 2^14 − 1 = 16383.
 */
export const HIGH_RESOLUTION_MAX = 2 ** 14 - 1;

/**
 * Unsigned pitch-bend centre: exactly half of the 14-bit span (0x2000 = 8192).
 * A bend arrives as an unsigned 0…16383 position; the app models it as the
 * signed offset from this centre.
 */
export const PITCH_BEND_CENTER = (HIGH_RESOLUTION_MAX + 1) / 2;

/** Most positive signed pitch-bend offset: one step below centre. */
export const PITCH_BEND_MAX = PITCH_BEND_CENTER - 1;

/**
 * Most negative signed pitch-bend offset: negated centre. The span is
 * asymmetric by one step because zero is the centre — 8192 steps down,
 * 8191 up.
 */
export const PITCH_BEND_MIN = -PITCH_BEND_CENTER;
