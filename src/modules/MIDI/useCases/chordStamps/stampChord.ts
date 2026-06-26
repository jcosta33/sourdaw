import { CHORD_TYPES, type ChordType } from '../../models/ChordTypes';
import { createMidiNote, type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

/**
 * Shift `pitch` by whole octaves so it lands within the valid MIDI range
 * [0, 127], preserving its pitch class. Returns `null` only if no octave
 * transposition can fit it (unreachable for finite inputs, but kept as an
 * explicit refusal rather than a silent drop).
 */
function fitPitchIntoRange(pitch: number): number | null {
    let fitted = pitch;
    while (fitted < 0) {
        fitted += 12;
    }
    while (fitted > 127) {
        fitted -= 12;
    }
    return fitted >= 0 && fitted <= 127 ? fitted : null;
}

/**
 * Stamp a chord at the given position, returning the created note IDs.
 */
export function stampChord(
    clipId: string,
    rootPitch: number,
    startBeat: number,
    duration: number,
    velocity: number,
    chordType: ChordType
): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }

    const intervals = CHORD_TYPES[chordType];
    const newNotes: MidiNote[] = [];

    // Clamp velocity to the audible MIDI range [1, 127]. A velocity of 0 is a
    // silent note; values above 127 are out of range.
    const safeVelocity = Math.round(Math.max(1, Math.min(127, velocity)));

    for (const interval of intervals) {
        // Octave-shift each chord tone into the valid MIDI range instead of
        // silently dropping it. A tone is only refused if it cannot be made to
        // fit within [0, 127] by whole-octave transposition (impossible, since
        // every pitch class has a representative in that span).
        const pitch = fitPitchIntoRange(rootPitch + interval);
        if (pitch !== null) {
            newNotes.push(createMidiNote(pitch, startBeat, duration, safeVelocity));
        }
    }

    const existing = state.notesByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, ...newNotes],
        },
    });

    return newNotes;
}
