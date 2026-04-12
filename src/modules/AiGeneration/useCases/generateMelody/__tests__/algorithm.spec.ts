import { describe, it, expect } from 'vitest';
import { generateMelody } from '../algorithm';

describe('generateMelody (algorithm)', () => {
    it('generates a deterministically seeded melody', () => {
        const result1 = generateMelody({
            style: 'arpeggiated',
            key: 0,
            scale: 'minor',
            bars: 2,
            seed: 42,
        });

        const result2 = generateMelody({
            style: 'arpeggiated',
            key: 0,
            scale: 'minor',
            bars: 2,
            seed: 42,
        });

        expect(result1.notes).toEqual(result2.notes);
        expect(result1.seed).toBe(42);
    });

    it('returns empty array if range is 0 and no notes fit', () => {
        const result = generateMelody({
            style: 'simple',
            key: 0,
            scale: 'major',
            range: -1, // Invalid range
        });
        expect(result.notes).toEqual([]);
    });

    it('respects density settings', () => {
        // Rhythmic style with very high density
        const dense = generateMelody({ style: 'rhythmic', key: 0, scale: 'pentatonic', bars: 4, density: 1, seed: 5 });
        
        // Rhythmic style with very low density (lots of rests)
        const sparse = generateMelody({ style: 'rhythmic', key: 0, scale: 'pentatonic', bars: 4, density: 0.1, seed: 5 });

        expect(sparse.notes.length).toBeLessThan(dense.notes.length);
    });

    it('clamps velocities within valid MIDI ranges', () => {
        const result = generateMelody({
            style: 'ambient', // Ambient has wild velocity swings
            key: 0,
            scale: 'major',
            bars: 8,
            seed: 10,
        });

        for (const note of result.notes) {
            expect(note.velocity).toBeGreaterThanOrEqual(1);
            expect(note.velocity).toBeLessThanOrEqual(127);
        }
    });
});
