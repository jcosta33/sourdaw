import { describe, it, expect } from 'vitest';

import { bassPatterns } from '../BassPatterns';

describe('BassPatterns', () => {
    it('exports a non-empty array', () => {
        expect(Array.isArray(bassPatterns)).toBe(true);
        expect(bassPatterns.length).toBeGreaterThan(3);
    });
    it('every pattern has id, name, and generate function', () => {
        for (const p of bassPatterns) {
            expect(p.id).toBeTruthy();
            expect(p.name).toBeTruthy();
            expect(typeof p.generate).toBe('function');
        }
    });
    it('all ids are unique', () => {
        const ids = bassPatterns.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
    it('every generate produces output', () => {
        for (const p of bassPatterns) {
            const notes = p.generate({ key: 0, scale: p.scaleOverride ?? 'major', density: 5, complexity: 5 });
            expect(Array.isArray(notes)).toBe(true);
        }
    });
    it('covers multiple genres', () => {
        const genres = new Set(bassPatterns.flatMap((p) => p.genres));
        expect(genres.size).toBeGreaterThan(2);
    });
});
