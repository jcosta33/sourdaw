import { describe, it, expect } from 'vitest';

import { ALL_KEYS, KEY_SEMITONES, SCALE_TYPES, SCALE_LABELS, SCALE_INTERVALS } from '../MidiPatternType';

describe('ALL_KEYS', () => {
    it('has 12 chromatic keys', () => {
        expect(ALL_KEYS).toHaveLength(12);
    });
    it('starts with C', () => {
        expect(ALL_KEYS[0]).toBe('C');
    });
    it('includes all sharps', () => {
        expect(ALL_KEYS).toContain('C#');
        expect(ALL_KEYS).toContain('F#');
        expect(ALL_KEYS).toContain('G#');
    });
});

describe('KEY_SEMITONES', () => {
    it('maps C to 0', () => {
        expect(KEY_SEMITONES.C).toBe(0);
    });
    it('maps B to 11', () => {
        expect(KEY_SEMITONES.B).toBe(11);
    });
    it('has entry for every key', () => {
        for (const key of ALL_KEYS) {
            expect(KEY_SEMITONES[key]).toBeDefined();
        }
    });
});

describe('SCALE_INTERVALS', () => {
    it('major scale has 7 intervals', () => {
        expect(SCALE_INTERVALS.major).toHaveLength(7);
    });
    it('minor scale has flat 3, 6, 7', () => {
        expect(SCALE_INTERVALS.minor).toContain(3);
        expect(SCALE_INTERVALS.minor).not.toContain(4);
        expect(SCALE_INTERVALS.minor).toContain(8);
        expect(SCALE_INTERVALS.minor).toContain(10);
    });
    it('blues scale has 6 notes', () => {
        expect(SCALE_INTERVALS.blues).toHaveLength(6);
    });
    it('pentatonic-minor has 5 notes', () => {
        expect(SCALE_INTERVALS['pentatonic-minor']).toHaveLength(5);
    });
    it('dorian has raised 6', () => {
        expect(SCALE_INTERVALS.dorian).toContain(9);
    });
    it('all scales start at 0 (root)', () => {
        for (const scale of SCALE_TYPES) {
            expect(SCALE_INTERVALS[scale][0]).toBe(0);
        }
    });
    it('all intervals are 0-11', () => {
        for (const scale of SCALE_TYPES) {
            for (const interval of SCALE_INTERVALS[scale]) {
                expect(interval).toBeGreaterThanOrEqual(0);
                expect(interval).toBeLessThanOrEqual(11);
            }
        }
    });
});

describe('SCALE_LABELS', () => {
    it('has label for every scale type', () => {
        for (const scale of SCALE_TYPES) {
            expect(SCALE_LABELS[scale]).toBeTruthy();
        }
    });
});
