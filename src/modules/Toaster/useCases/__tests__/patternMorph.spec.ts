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
});
