/**
 * Chord transposition transformer — pure functions with no store access.
 *
 * Maps MIDI pitches between chords while preserving musical function:
 * - Chord tones map to matching chord tones (root→root, 3rd→3rd)
 * - Non-chord tones shift by the root difference (chromatic offset)
 */

import { type ChordEvent } from '../models/ChordEvent';
import { type ChordType, CHORD_TYPES } from '../models/ChordTypes';

export function transposeNoteToChord(
    pitch: number,
    fromRoot: number,
    fromQuality: ChordType,
    toRoot: number,
    toQuality: ChordType
): number {
    if (fromRoot === toRoot && fromQuality === toQuality) {
        return pitch;
    }

    const fromIntervals = Array.from(CHORD_TYPES[fromQuality]) as number[];
    const toIntervals = Array.from(CHORD_TYPES[toQuality]) as number[];

    // Determine the note's interval relative to the source root
    const semitoneFromRoot = (((pitch - fromRoot) % 12) + 12) % 12;

    // Check if this note is a chord tone in the source chord
    const chordToneIndex = fromIntervals.indexOf(semitoneFromRoot);

    if (chordToneIndex !== -1 && chordToneIndex < toIntervals.length) {
        // It's a chord tone — map to the same index in the target chord
        const targetInterval = toIntervals[chordToneIndex] ?? 0;
        const octave = Math.floor((pitch - fromRoot) / 12);
        return toRoot + octave * 12 + targetInterval;
    }

    // Non-chord tone: simple chromatic shift by root difference
    const rootDiff = toRoot - fromRoot;
    return pitch + rootDiff;
}

/**
 * Convenience: transpose a MIDI pitch given two ChordEvent objects.
 * If either is null, returns original pitch unchanged.
 */
export function transposeForChordTrack(
    pitch: number,
    referenceChord: ChordEvent | null,
    targetChord: ChordEvent | null
): number {
    if (!referenceChord || !targetChord) {
        return pitch;
    }
    return transposeNoteToChord(
        pitch,
        referenceChord.root,
        referenceChord.quality,
        targetChord.root,
        targetChord.quality
    );
}
