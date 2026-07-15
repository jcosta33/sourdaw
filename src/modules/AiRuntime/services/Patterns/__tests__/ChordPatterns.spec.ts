import { describe, it, expect } from 'vitest';

import { chordPatterns } from '../ChordPatterns';

describe('ChordPatterns', () => {
    it('exports a non-empty array of patterns', () => {
        expect(chordPatterns.length).toBeGreaterThan(10);
    });

    it('every pattern has required metadata fields', () => {
        for (const p of chordPatterns) {
            expect(p.id).toBeTruthy();
            expect(p.name).toBeTruthy();
            expect(p.category).toBe('chords');
            expect(p.genres.length).toBeGreaterThan(0);
            expect(p.lengthBeats).toBeGreaterThan(0);
            expect(typeof p.generate).toBe('function');
        }
    });

    it('all pattern ids are unique', () => {
        const ids = chordPatterns.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every generate function runs without crash', () => {
        for (const p of chordPatterns) {
            const notes = p.generate({ key: 0, scale: p.scaleOverride ?? 'major', density: 5, complexity: 5 });
            expect(Array.isArray(notes)).toBe(true);
        }
    });

    it('generate produces different note count for different density', () => {
        const pattern = chordPatterns[0]!;
        const low = pattern.generate({ key: 0, scale: 'major', density: 1, complexity: 5 });
        const high = pattern.generate({ key: 0, scale: 'major', density: 9, complexity: 5 });
        expect(low.length).not.toBe(high.length);
    });

    it('patterns cover multiple genres', () => {
        const all_genres = new Set(chordPatterns.flatMap((p) => p.genres));
        expect(all_genres.size).toBeGreaterThan(5);
        expect(all_genres.has('pop')).toBe(true);
    });

    it('scale override is set for some patterns', () => {
        const overridden = chordPatterns.filter((p) => p.scaleOverride !== undefined);
        expect(overridden.length).toBeGreaterThan(0);
    });

    it('complexity affects chord voicing', () => {
        const pattern = chordPatterns.find((p) => p.id === 'ch-1564')!;
        const simple = pattern.generate({ key: 0, scale: 'major', density: 5, complexity: 1 });
        const complex = pattern.generate({ key: 0, scale: 'major', density: 5, complexity: 9 });
        expect(simple.length).not.toBe(complex.length);
    });
});
