import { describe, it, expect } from 'vitest';

import { morphPatterns } from '../patternMorph';

const baseStep = {
    active: false,
    velocity: 0.5,
    probability: 1,
    microTiming: 0,
    retriggerCount: 0,
    condition: 'always' as const,
    paramLocks: {},
};

function makePattern(id: string, velocities: number[]) {
    return {
        id,
        name: id,
        stepsPerBar: 16,
        bars: 1,
        tracks: [
            {
                padIndex: 0,
                steps: velocities.map((value) => ({ ...baseStep, velocity: value })),
            },
        ],
    } as never;
}

describe('morphPatterns', () => {
    it('lerps velocity between two patterns at the midpoint', () => {
        const alpha = makePattern('a', [0, 0.5]);
        const b = makePattern('b', [1, 0.5]);
        const morphed = morphPatterns(alpha, b, 0.5) as { tracks: { steps: { velocity: number }[] }[] };
        expect(morphed.tracks[0]!.steps[0]!.velocity).toBe(0.5);
    });

    it('clamps t to [0, 1]', () => {
        const alpha = makePattern('a', [0]);
        const b = makePattern('b', [1]);
        const high = morphPatterns(alpha, b, 5) as { tracks: { steps: { velocity: number }[] }[] };
        const low = morphPatterns(alpha, b, -1) as { tracks: { steps: { velocity: number }[] }[] };
        expect(high.tracks[0]!.steps[0]!.velocity).toBe(1);
        expect(low.tracks[0]!.steps[0]!.velocity).toBe(0);
    });

    it('falls back to A track when B has no matching index', () => {
        const alpha = {
            id: 'a',
            name: 'a',
            stepsPerBar: 16,
            bars: 1,
            tracks: [
                { padIndex: 0, steps: [{ ...baseStep }] },
                { padIndex: 1, steps: [{ ...baseStep }] },
            ],
        } as never;
        const b = makePattern('b', [0]);
        const morphed = morphPatterns(alpha, b, 0.5) as { tracks: { padIndex: number }[] };
        expect(morphed.tracks).toHaveLength(2);
    });

    // Regression — Finding (morph re-rolled Math.random() per tick, so a held
    // mid-morph pattern flickered nondeterministically. Activation must be
    // deterministic and reproducible for a fixed position.
    it('resolves step activation deterministically (no per-call randomness)', () => {
        const onlyA = { ...baseStep, active: true };
        const offB = { ...baseStep, active: false };
        const alpha = { ...makePattern('a', [0]) } as { tracks: { steps: unknown[] }[] };
        alpha.tracks[0]!.steps[0] = onlyA;
        const b = { ...makePattern('b', [0]) } as { tracks: { steps: unknown[] }[] };
        b.tracks[0]!.steps[0] = offB;

        type Out = { tracks: { steps: { active: boolean }[] }[] };
        const first = morphPatterns(alpha as never, b as never, 0.3) as Out;
        // Identical inputs and position must yield an identical result every call.
        for (let i = 0; i < 20; i++) {
            const again = morphPatterns(alpha as never, b as never, 0.3) as Out;
            expect(again.tracks[0]!.steps[0]!.active).toBe(first.tracks[0]!.steps[0]!.active);
        }
        // At t=0.3, A's activation (prob 0.7) dominates the 0.5 threshold.
        expect(first.tracks[0]!.steps[0]!.active).toBe(true);

        // Past the midpoint, B's "off" wins (A's activation prob 0.4 < 0.5).
        const past = morphPatterns(alpha as never, b as never, 0.6) as Out;
        expect(past.tracks[0]!.steps[0]!.active).toBe(false);
    });

    // Regression — Finding #51: the synthetic morph id was `morph-${a}-${b}`,
    // which a user pattern named "morph-A1-A2" could collide with. The id must
    // live in a reserved namespace that user/preset ids can't produce.
    it('namespaces the synthetic morph id so it cannot collide with user pattern ids', () => {
        const alpha = makePattern('A1', [0]);
        const b = makePattern('A2', [1]);
        const morphed = morphPatterns(alpha, b, 0.5) as { id: string };
        expect(morphed.id).not.toBe('morph-A1-A2');
        // Reserved sentinel: a NUL control char that the id scheme never emits.
        expect(morphed.id.charCodeAt(0)).toBe(0);
    });
});
