import { describe, it, expect } from 'vitest';

import { generateDrumPattern } from '../algorithm';

describe('generateDrumPattern (algorithm)', () => {
    it('generates a deterministically seeded pattern', () => {
        const result1 = generateDrumPattern({
            style: 'house',
            bars: 2,
            density: 0.8,
            swing: 0.2,
            timeSignature: [4, 4],
            seed: 999,
        });

        const result2 = generateDrumPattern({
            style: 'house',
            bars: 2,
            density: 0.8,
            swing: 0.2,
            timeSignature: [4, 4],
            seed: 999,
        });

        expect(result1.notes).toEqual(result2.notes);
        expect(result1.seed).toBe(999);
    });

    it('respects density controls', () => {
        const sparse = generateDrumPattern({ style: 'trap', bars: 4, density: 0.1, seed: 1 });
        const dense = generateDrumPattern({ style: 'trap', bars: 4, density: 1.0, seed: 1 });

        expect(sparse.notes.length).toBeLessThan(dense.notes.length);
    });

    it('applies swing correctly', () => {
        // Without swing, notes fall exactly on grid subdivisions
        const straight = generateDrumPattern({ style: 'four-on-floor', bars: 1, swing: 0, seed: 1 });

        // With swing, off-beats are delayed
        const swung = generateDrumPattern({ style: 'four-on-floor', bars: 1, swing: 0.5, seed: 1 });

        const straightStarts = straight.notes.map((node) => node.startBeat);
        const swungStarts = swung.notes.map((node) => node.startBeat);

        // At least one swung note should fall on a non-clean grid division
        const hasSwungNote = swungStarts.some((beat) => beat % 0.25 !== 0);
        const allStraightNotes = straightStarts.every((beat) => beat % 0.25 === 0);

        expect(allStraightNotes).toBe(true);
        expect(hasSwungNote).toBe(true);
    });
});
