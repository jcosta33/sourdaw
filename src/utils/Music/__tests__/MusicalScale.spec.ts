import { describe, it, expect } from 'vitest';

import {
    getScaleLabel,
    getScalePattern,
    SCALE_LABELS,
    SCALE_PATTERNS,
    SCALE_NAMES,
    KEY_NAMES,
    quantizeCentsToScale,
    quantizeMidiNoteToScale,
} from '../MusicalScale';

describe('scale labels', () => {
    it('labels every pattern with words, never its identifier', () => {
        expect(Object.keys(SCALE_LABELS).sort()).toEqual(Object.keys(SCALE_PATTERNS).sort());
        expect(getScaleLabel('harmonicMinor')).toBe('Harmonic Minor');
        expect(getScaleLabel('melodicMinor')).toBe('Melodic Minor');
        expect(getScaleLabel('pentatonicMajor')).toBe('Pentatonic Major');
        expect(getScaleLabel('pentatonicMinor')).toBe('Pentatonic Minor');
        expect(getScaleLabel('wholeTone')).toBe('Whole Tone');
        expect(getScaleLabel('major')).toBe('Major');
    });

    it('falls back to the identifier for an unknown scale', () => {
        expect(getScaleLabel('custom')).toBe('custom');
    });

    it('falls back to the identifier for names that are Object.prototype members', () => {
        expect(getScaleLabel('__proto__')).toBe('__proto__');
        expect(getScaleLabel('constructor')).toBe('constructor');
        expect(getScaleLabel('toString')).toBe('toString');
    });
});

describe('scale data', () => {
    it('should expose every pattern name via SCALE_NAMES', () => {
        expect(SCALE_NAMES).toEqual(Object.keys(SCALE_PATTERNS));
        expect(SCALE_NAMES).toContain('major');
        expect(SCALE_NAMES).toContain('chromatic');
    });

    it('should expose 12 chromatic key names starting at C', () => {
        expect(KEY_NAMES).toHaveLength(12);
        expect(KEY_NAMES[0]).toBe('C');
        expect(KEY_NAMES[11]).toBe('B');
    });

    it('should define the chromatic pattern as every pitch class', () => {
        expect(SCALE_PATTERNS.chromatic).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });
});

describe('quantizeCentsToScale', () => {
    it('should leave cents already on a scale degree unchanged', () => {
        // 200 cents from root 0 is pitch class 2, which is in the major scale.
        expect(quantizeCentsToScale(200, 0, 'major')).toBe(200);
    });

    it('should snap an out-of-scale pitch to the nearest scale degree', () => {
        // 100 cents (pitch class 1) is not in major; classes 0 and 2 tie at
        // distance 1, and the first pattern entry (0) wins the tie.
        expect(quantizeCentsToScale(100, 0, 'major')).toBe(0);
    });

    it('should account for a non-zero root when computing the pitch class', () => {
        expect(quantizeCentsToScale(200, 2, 'major')).toBe(200);
    });

    it('should wrap around the octave boundary in the shorter direction', () => {
        // Pitch class 11 is not in dorian ([0,2,3,5,7,9,10]); the nearest
        // degree is 0 in the octave above, one semitone up, not eleven down.
        expect(quantizeCentsToScale(1100, 0, 'dorian')).toBe(1200);
    });

    it('should fall back to the chromatic scale for an unknown scale name', () => {
        expect(quantizeCentsToScale(150, 0, 'not-a-real-scale')).toBe(150);
    });
});

describe('quantizeMidiNoteToScale', () => {
    // C# major pentatonic = pitch classes 1,3,5,8,10. The nearest degree to 127 (pc 7) is 128, out of range;
    // the nearest in-range degree below is 125 (pc 5).
    it('stays in scale when the nearest degree is above the MIDI range', () => {
        expect(quantizeMidiNoteToScale(127, 1, 'pentatonicMajor')).toBe(125);
    });

    // B major pentatonic = pitch classes 11,1,3,6,8. The nearest degree to 0 is -1, out of range;
    // the lowest in-range degree is 1 (C#).
    it('stays in scale when the nearest degree is below the MIDI range', () => {
        expect(quantizeMidiNoteToScale(0, 11, 'pentatonicMajor')).toBe(1);
    });

    it('leaves an in-range snap at the edge unchanged', () => {
        // C major: 127 (G) is in scale; 1 (C#) snaps down to 0 (C), still in range.
        expect(quantizeMidiNoteToScale(127, 0, 'major')).toBe(127);
        expect(quantizeMidiNoteToScale(1, 0, 'major')).toBe(0);
    });

    it('should leave a note already on a scale degree unchanged', () => {
        expect(quantizeMidiNoteToScale(60, 0, 'major')).toBe(60);
    });

    it('should snap an out-of-scale note to the nearest scale degree', () => {
        // MIDI 61 (C#) is pitch class 1, not in major; ties with class 0 and
        // 2 at distance 1, and the first pattern entry (0) wins.
        expect(quantizeMidiNoteToScale(61, 0, 'major')).toBe(60);
    });

    it('should wrap around the octave boundary in the shorter direction', () => {
        // MIDI 23 has pitch class 11, absent from dorian; nearest is 0 one
        // octave up, reached by +1 semitone rather than -11.
        expect(quantizeMidiNoteToScale(23, 0, 'dorian')).toBe(24);
    });

    it('should fall back to the chromatic scale for an unknown scale name', () => {
        expect(quantizeMidiNoteToScale(61, 0, 'not-a-real-scale')).toBe(61);
    });

    it('should never return a note outside the MIDI range at the low boundary', () => {
        const result = quantizeMidiNoteToScale(0, 1, 'major');
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(127);
    });

    it('should never return a note outside the MIDI range at the high boundary', () => {
        const result = quantizeMidiNoteToScale(127, 1, 'major');
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(127);
    });
});

describe('getScalePattern', () => {
    it('returns the pattern for a known scale', () => {
        expect(getScalePattern('dorian')).toEqual([0, 2, 3, 5, 7, 9, 10]);
    });

    it.each(['__proto__', 'constructor', 'toString'])('returns undefined for Object.prototype member %s', (name) => {
        expect(getScalePattern(name)).toBeUndefined();
    });

    it.each(['__proto__', 'constructor', 'toString'])('quantizes as chromatic for %s', (name) => {
        expect(quantizeCentsToScale(150, 0, name)).toBe(150);
        expect(quantizeMidiNoteToScale(61, 0, name)).toBe(61);
    });
});
