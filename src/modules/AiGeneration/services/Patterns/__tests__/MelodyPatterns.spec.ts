import { describe, it, expect } from 'vitest';

import { melodyPatterns } from '../MelodyPatterns';

describe('MelodyPatterns', () => {
    it('exports a non-empty array', () => {
        expect(Array.isArray(melodyPatterns)).toBe(true);
        expect(melodyPatterns.length).toBeGreaterThan(3);
    });
    it('every pattern has id, name, and generate function', () => {
        for (const p of melodyPatterns) {
            expect(p.id).toBeTruthy();
            expect(p.name).toBeTruthy();
            expect(typeof p.generate).toBe('function');
        }
    });
    it('all ids are unique', () => {
        const ids = melodyPatterns.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
    it('every generate produces output', () => {
        for (const p of melodyPatterns) {
            const notes = p.generate({ key: 'C', scale: p.scaleOverride ?? 'major', density: 5, complexity: 5 });
            expect(Array.isArray(notes)).toBe(true);
        }
    });
    it('covers multiple genres', () => {
        const genres = new Set(melodyPatterns.flatMap((p) => p.genres));
        expect(genres.size).toBeGreaterThan(2);
    });
});
