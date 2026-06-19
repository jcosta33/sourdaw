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
        const sparse = generateMelody({
            style: 'rhythmic',
            key: 0,
            scale: 'pentatonic',
            bars: 4,
            density: 0.1,
            seed: 5,
        });

        expect(sparse.notes.length).toBeLessThan(dense.notes.length);
    });

    it('never emits an out-of-scale pitch for arpeggiated wrap on a short scale', () => {
        // Regression: the arpeggiated wrap used `len + (next % len)`, which
        // returns `len` (an out-of-bounds index → undefined pitch coerced to a
        // bogus number) when `next === -len`. This is reachable on short scales
        // (len <= 3). `range: 4` over minor-pentatonic ([0,3,5,7,10]) yields a
        // 2-note scale, which exercises the wrap. Every generated pitch must be
        // a finite number drawn from that 2-note scale.
        for (let seed = 0; seed < 200; seed++) {
            const result = generateMelody({
                style: 'arpeggiated',
                key: 0,
                scale: 'minor-pentatonic',
                octave: 4,
                bars: 4,
                density: 1,
                range: 4,
                seed,
            });

            // Same short scale the algorithm builds: baseMidi = key + octave*12
            // = 0 + 48 = 48; minor-pentatonic intervals [0,3,...] within range 4
            // → notes 48 and 51 (a 2-note scale).
            const allowed = new Set([48, 51]);
            for (const note of result.notes) {
                expect(Number.isFinite(note.pitch)).toBe(true);
                expect(allowed.has(note.pitch)).toBe(true);
            }
        }
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
