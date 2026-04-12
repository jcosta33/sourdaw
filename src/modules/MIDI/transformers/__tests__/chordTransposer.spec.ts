import { describe, expect, it } from 'vitest';

import { transposeForChordTrack, transposeNoteToChord } from '../chordTransposer';

const chord = (root: number, quality: 'major' | 'minor' | '7') => ({
    id: 'c',
    beat: 0,
    root,
    quality,
    duration: 4,
});

describe('transposeForChordTrack', () => {
    it('should return the pitch unchanged when reference or target is missing', () => {
        expect(transposeForChordTrack(60, null, chord(2, 'major'))).toBe(60);
        expect(transposeForChordTrack(60, chord(0, 'major'), null)).toBe(60);
    });

    it('should transpose using the underlying chord mapping when both chords exist', () => {
        const out = transposeForChordTrack(60, chord(0, 'major'), chord(2, 'major'));
        expect(out).toBe(62);
    });
});

describe('transposeNoteToChord', () => {
    it('is a no-op when roots and qualities match', () => {
        expect(transposeNoteToChord(64, 0, 'major', 0, 'major')).toBe(64);
    });

    it('should map chord tones by degree when moving from C major to D major', () => {
        expect(transposeNoteToChord(60, 0, 'major', 2, 'major')).toBe(62);
        expect(transposeNoteToChord(64, 0, 'major', 2, 'major')).toBe(66);
    });

    it('should shift non-chord tones by the root interval', () => {
        expect(transposeNoteToChord(61, 0, 'major', 2, 'major')).toBe(63);
    });

    it('should map minor triads when moving roots by two semitones', () => {
        expect(transposeNoteToChord(60, 0, 'minor', 2, 'minor')).toBe(62);
        expect(transposeNoteToChord(63, 0, 'minor', 2, 'minor')).toBe(65);
    });

    it('should carry octave when transposing chord roots across octaves', () => {
        expect(transposeNoteToChord(72, 0, 'major', 2, 'major')).toBe(74);
        expect(transposeNoteToChord(84, 0, 'major', 2, 'major')).toBe(86);
    });

    it('should use minor qualities end-to-end in transposeForChordTrack', () => {
        const ref = { id: 'r', beat: 0, root: 0, quality: 'minor' as const, duration: 4 };
        const tgt = { id: 't', beat: 0, root: 5, quality: 'minor' as const, duration: 4 };
        expect(transposeForChordTrack(60, ref, tgt)).toBe(65);
    });

    it('should map dominant seventh chord tones from C to Eb', () => {
        expect(transposeNoteToChord(60, 0, '7', 3, '7')).toBe(63);
        expect(transposeNoteToChord(64, 0, '7', 3, '7')).toBe(67);
    });

    it('should shift chromatically when the pitch is outside the source chord tones', () => {
        expect(transposeNoteToChord(61, 0, 'dim', 2, 'dim')).toBe(63);
    });
});
