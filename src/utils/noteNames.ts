export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type NoteName = (typeof NOTE_NAMES)[number];

/**
 * Pitch name with octave for a MIDI note, using the convention that middle C (60) is C4.
 * Returns null for anything that is not an integer in 0..127.
 */
export function formatMidiNoteName(midiNote: number): string | null {
    if (!Number.isInteger(midiNote) || midiNote < 0 || midiNote > 127) {
        return null;
    }
    const octave = Math.floor(midiNote / 12) - 1;
    return `${NOTE_NAMES[midiNote % 12]}${octave}`;
}
