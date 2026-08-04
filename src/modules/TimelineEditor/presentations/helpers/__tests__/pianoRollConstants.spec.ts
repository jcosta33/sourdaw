import { describe, it, expect } from 'vitest';

import { getVisiblePitches, TOTAL_ROWS, BASE_PITCH } from '../pianoRollConstants';

describe('getVisiblePitches — unfolded (all pitches)', () => {
    it('returns all 60 pitches descending from 83 to 24 when unfolded', () => {
        const pitches = getVisiblePitches('chromatic', 0, false);
        expect(pitches).toHaveLength(TOTAL_ROWS);
        expect(pitches[0]).toBe(BASE_PITCH + TOTAL_ROWS - 1); // 83
        expect(pitches[pitches.length - 1]).toBe(BASE_PITCH); // 24
    });

    it('returns all pitches even with a non-chromatic scale when unfolded', () => {
        const pitches = getVisiblePitches('major', 0, false);
        expect(pitches).toHaveLength(TOTAL_ROWS);
    });

    it('falls back to chromatic for an unknown scale type', () => {
        const pitches = getVisiblePitches('nonexistent', 0, false);
        expect(pitches).toHaveLength(TOTAL_ROWS);
    });
});

describe('getVisiblePitches — folded (scale-filtered)', () => {
    it('filters to only in-scale pitches when folded (C major)', () => {
        const pitches = getVisiblePitches('major', 0, true);
        // C major intervals: [0,2,4,5,7,9,11]. 7 out of 12 pitch classes per octave.
        // Over 60 rows (5 octaves): 5 * 7 = 35 pitches.
        expect(pitches).toHaveLength(35);
    });

    it('all folded pitches are in the C major scale', () => {
        const pitches = getVisiblePitches('major', 0, true);
        const majorIntervals = new Set([0, 2, 4, 5, 7, 9, 11]);
        for (const pitch of pitches) {
            const pc = pitch % 12;
            expect(majorIntervals.has(pc)).toBe(true);
        }
    });

    it('starts from the highest pitch (83) descending', () => {
        const pitches = getVisiblePitches('major', 0, true);
        // 83 % 12 = 11 → B, which is in C major (interval 11). So 83 is first.
        expect(pitches[0]).toBe(83);
    });

    it('respects scaleRoot offset (D major: root=2)', () => {
        const pitches = getVisiblePitches('major', 2, true);
        const majorIntervals = new Set([0, 2, 4, 5, 7, 9, 11]);
        for (const pitch of pitches) {
            const relativeNote = ((pitch % 12) - 2 + 12) % 12;
            expect(majorIntervals.has(relativeNote)).toBe(true);
        }
    });

    it('pentatonic folded has fewer pitches than major folded', () => {
        const majorPitches = getVisiblePitches('major', 0, true);
        const pentatonicPitches = getVisiblePitches('pentatonicMajor', 0, true);
        // Pentatonic has 5 intervals vs major's 7.
        expect(pentatonicPitches.length).toBeLessThan(majorPitches.length);
    });
});
